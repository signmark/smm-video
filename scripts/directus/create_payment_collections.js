/**
 * Создаёт коллекции, на которых держится защита оплаты:
 *
 *   payment_activations — журнал обработанных платежей (идемпотентность активации);
 *   promo_reservations  — атомарное резервирование скидочных промокодов.
 *
 * Почему отдельным скриптом, а не из приложения: сервисный токен
 * (DIRECTUS_STATIC_TOKEN) не имеет прав на изменение схемы — Directus отвечает 403
 * и на GET /collections/<новая>, и на POST /collections. Схему меняют скрипты в
 * scripts/directus/, логинясь под админом; это штатный механизм проекта (тем же
 * способом заводились поля user_campaigns).
 *
 * Скрипт идемпотентен: существующие коллекции не трогает, повторный запуск безопасен.
 *
 * Запуск с хоста прода:
 *   node scripts/directus/create_payment_collections.js
 *
 * ВАЖНО про атомарность. Уникальные индексы здесь — не украшение, а сам механизм:
 *   - payment_activations.payment_id  — захват платежа = вставка строки;
 *   - promo_reservations.payment_id   — одна бронь на платёж;
 *   - promo_reservations.user_lock    — один скидочный код на пользователя;
 *   - promo_reservations.slot_lock    — соблюдение max_uses без read-then-increment.
 * Без них обе защиты превращаются в проверку-и-гонку.
 */
import axios from 'axios';
import * as dotenv from 'dotenv';

// Путь к файлу окружения задаётся снаружи: на прод-хосте это /root/.env.
// Класть .env в корень репозитория нельзя — server/load-env.ts читает его с
// override: true относительно cwd и молча перекрывает переменные контейнера
// (docs/DEPLOYMENT.md, «Почему /root/smm/.env быть не должно»).
dotenv.config({ path: process.env.ENV_FILE || '.env' });

const DIRECTUS_URL = process.env.DIRECTUS_URL || 'https://directus.nplanner.ru';
const DIRECTUS_EMAIL = process.env.DIRECTUS_ADMIN_EMAIL;
const DIRECTUS_PASSWORD = process.env.DIRECTUS_ADMIN_PASSWORD;

/** Первичный ключ. Без явного PK Directus отказывается создавать таблицу с fields. */
const PK_FIELD = {
  field: 'id',
  type: 'uuid',
  meta: { hidden: true, readonly: true, interface: 'input', special: ['uuid'] },
  schema: { is_primary_key: true, length: 36, has_auto_increment: false },
};

const COLLECTIONS = [
  {
    collection: 'payment_activations',
    note: 'Журнал обработанных платежей ЮКассы (идемпотентность активации подписки)',
    fields: [
      { field: 'payment_id', type: 'string', meta: { required: true }, schema: { is_unique: true, is_nullable: false } },
      { field: 'user_id', type: 'string', schema: { is_nullable: true } },
      { field: 'plan', type: 'string', schema: { is_nullable: true } },
      { field: 'amount', type: 'string', schema: { is_nullable: true } },
      { field: 'currency', type: 'string', schema: { is_nullable: true } },
      { field: 'status', type: 'string', schema: { is_nullable: false, default_value: 'processing' } },
      { field: 'source', type: 'string', schema: { is_nullable: true } },
      { field: 'claimed_at', type: 'timestamp', schema: { is_nullable: true } },
      { field: 'completed_at', type: 'timestamp', schema: { is_nullable: true } },
      // Заполняется, если активация оборвалась между выдачей подписки и отметкой
      // completed: такие записи разбираются вручную, автоматически не перехватываются.
      { field: 'needs_reconciliation', type: 'boolean', schema: { is_nullable: true, default_value: false } },
      { field: 'last_error', type: 'text', schema: { is_nullable: true } },
    ],
  },
  {
    collection: 'promo_reservations',
    note: 'Брони скидочных промокодов под конкретный платёж',
    fields: [
      // Здесь лежит НАШ order_id (он же metadata.order_id платежа), а не id ЮКассы:
      // бронь берётся до создания платежа, когда id ЮКассы ещё не существует.
      { field: 'payment_id', type: 'string', meta: { required: true }, schema: { is_unique: true, is_nullable: false } },
      // Проставляется после создания платежа — по нему выясняем, не отменён ли платёж,
      // державший слот, чтобы освободить бронь по факту, а не по догадке.
      { field: 'yookassa_payment_id', type: 'string', schema: { is_nullable: true } },
      { field: 'promo_code_id', type: 'string', schema: { is_nullable: true } },
      { field: 'user_id', type: 'string', schema: { is_nullable: true } },
      // `<promo_id>:<user_id>` — один скидочный код одному пользователю один раз.
      // Обнуляется при release, поэтому отменённый платёж код не сжигает
      // (в Postgres уникальный индекс допускает сколько угодно NULL).
      { field: 'user_lock', type: 'string', schema: { is_unique: true, is_nullable: true } },
      // `<promo_id>:#<n>` — n-е использование кода. Занятый слот отдаёт конфликт
      // уникальности, и претендент берёт следующий номер; так max_uses соблюдается
      // без чтения-и-инкремента счётчика.
      { field: 'slot_lock', type: 'string', schema: { is_unique: true, is_nullable: true } },
      { field: 'slot_index', type: 'integer', schema: { is_nullable: true } },
      { field: 'status', type: 'string', schema: { is_nullable: false, default_value: 'reserved' } },
      { field: 'reserved_at', type: 'timestamp', schema: { is_nullable: true } },
      { field: 'completed_at', type: 'timestamp', schema: { is_nullable: true } },
      { field: 'released_at', type: 'timestamp', schema: { is_nullable: true } },
      // Заполняется, когда автоматика не смогла довести бронь до однозначного
      // состояния: платёж создан, но связать его с бронью не удалось, а отмену
      // платежа в ЮКассе подтвердить не получилось. Такую бронь НЕ освобождаем
      // (иначе скидку получат дважды) и разбираем руками.
      { field: 'needs_reconciliation', type: 'boolean', schema: { is_nullable: true, default_value: false } },
      // Отметка «по этой брони уже пошли в платёжную систему». Отличает бронь,
      // брошенную ДО создания платежа (её можно освободить), от той, где платёж
      // создан, а привязка сорвалась (слот держим). См. promo-reservation.ts.
      { field: 'payment_attempt_at', type: 'timestamp', schema: { is_nullable: true } },
      { field: 'last_error', type: 'text', schema: { is_nullable: true } },
    ],
  },
];

async function login() {
  if (!DIRECTUS_EMAIL || !DIRECTUS_PASSWORD) {
    throw new Error('Нет DIRECTUS_ADMIN_EMAIL / DIRECTUS_ADMIN_PASSWORD в окружении');
  }
  const res = await axios.post(`${DIRECTUS_URL}/auth/login`, {
    email: DIRECTUS_EMAIL,
    password: DIRECTUS_PASSWORD,
  });
  return res.data.data.access_token;
}

async function ensureCollection(token, def) {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  try {
    const existing = await axios.get(`${DIRECTUS_URL}/collections/${def.collection}`, { headers });
    if (existing.data.data.schema) {
      console.log(`= ${def.collection}: уже существует`);
      await ensureFields(token, def);
      return 'exists';
    }
    // schema === null → это «папка» без таблицы, артефакт неудачного прогона.
    // Данных в ней быть не может по определению, поэтому пересоздаём.
    console.log(`! ${def.collection}: существует как папка без таблицы — пересоздаю`);
    await axios.delete(`${DIRECTUS_URL}/collections/${def.collection}`, { headers });
  } catch (err) {
    if (err.response?.status !== 403 && err.response?.status !== 404) throw err;
  }

  await axios.post(
    `${DIRECTUS_URL}/collections`,
    {
      collection: def.collection,
      // `schema: {}` обязателен. Без него Directus заводит «папку» — запись в
      // directus_collections без таблицы в БД, и любой /items/<коллекция> отвечает
      // 403 даже админу. Ровно на это я и наступил при первом прогоне.
      schema: {},
      meta: { note: def.note },
      fields: [PK_FIELD, ...def.fields],
    },
    { headers },
  );
  console.log(`+ ${def.collection}: создана`);
  return 'created';
}

/**
 * Досоздаёт недостающие поля в уже существующей коллекции.
 *
 * Нужно, потому что схема дозревала по ходу: `yookassa_payment_id` появился позже
 * самой коллекции. Пропускать существующую коллекцию целиком нельзя — новые поля
 * тогда не доедут до прода.
 */
async function ensureFields(token, def) {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  for (const field of def.fields) {
    try {
      await axios.get(`${DIRECTUS_URL}/fields/${def.collection}/${field.field}`, { headers });
    } catch (err) {
      if (err.response?.status !== 403 && err.response?.status !== 404) throw err;
      await axios.post(`${DIRECTUS_URL}/fields/${def.collection}`, field, { headers });
      console.log(`   + поле ${def.collection}.${field.field} добавлено`);
    }
  }
}

/**
 * Проверяет уникальные индексы функционально: вставляет строку-зонд, потом дубль по
 * тому же полю и ждёт отказа.
 *
 * Почему не по метаданным: `GET /fields/<collection>` в этом Directus отвечает 403
 * даже под админом (при том что `POST /collections` разрешён). Функциональная проверка
 * к тому же сильнее — она подтверждает не запись в схеме, а реальное поведение БД,
 * на которое и опирается захват платежа.
 */
async function verifyUniques(token, def) {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const uniqueFields = def.fields.filter(f => f.schema?.is_unique).map(f => f.field);
  const required = def.fields.filter(f => f.schema?.is_nullable === false && f.field !== 'id');

  let ok = true;
  for (const field of uniqueFields) {
    const probe = `__probe__${field}__${Date.now()}`;
    const base = {};
    for (const r of required) base[r.field] = r.schema.default_value ?? `__probe__${Date.now()}`;
    base[field] = probe;
    // payment_id обязателен и уникален в обеих коллекциях — не даём ему совпасть
    // с зондом другого поля.
    if (field !== 'payment_id') base.payment_id = `__probe__pay__${field}__${Date.now()}`;

    const created = [];
    try {
      const first = await axios.post(`${DIRECTUS_URL}/items/${def.collection}`, base, { headers });
      created.push(first.data.data.id);

      // Дубль отличается от зонда ВСЕМ, кроме проверяемого поля. payment_id меняем
      // только когда проверяем не его: иначе «дубль» перестаёт быть дублем и проверка
      // всегда проходит — на этом я один раз уже обжёгся.
      const duplicate = { ...base };
      if (field !== 'payment_id') duplicate.payment_id = `${base.payment_id}__dup`;

      let duplicateRejected = false;
      try {
        const second = await axios.post(
          `${DIRECTUS_URL}/items/${def.collection}`,
          duplicate,
          { headers },
        );
        created.push(second.data.data.id);
      } catch (err) {
        const body = JSON.stringify(err.response?.data || '');
        duplicateRejected = /unique|RECORD_NOT_UNIQUE|duplicate/i.test(body);
      }

      console.log(`   ${duplicateRejected ? '✓' : '✗'} ${def.collection}.${field}: дубль ${duplicateRejected ? 'отклонён' : 'ПРОШЁЛ'}`);
      if (!duplicateRejected) ok = false;
    } catch (err) {
      console.log(`   ✗ ${def.collection}.${field}: зонд не вставился — ${err.response?.status} ${JSON.stringify(err.response?.data?.errors?.[0]?.message || '').slice(0, 120)}`);
      ok = false;
    } finally {
      for (const id of created) {
        await axios.delete(`${DIRECTUS_URL}/items/${def.collection}/${id}`, { headers }).catch(() => {});
      }
    }
  }
  return ok;
}

async function main() {
  console.log(`Directus: ${DIRECTUS_URL}`);
  const token = await login();
  console.log('Аутентификация под админом прошла');

  let allOk = true;
  for (const def of COLLECTIONS) {
    await ensureCollection(token, def);
    const ok = await verifyUniques(token, def);
    if (!ok) allOk = false;
  }

  if (!allOk) {
    console.error('\nНЕ ВСЕ уникальные индексы на месте — защита оплаты работать не будет.');
    process.exit(1);
  }
  console.log('\nГотово: обе коллекции на месте, уникальные индексы подтверждены.');
}

main().catch(err => {
  console.error('Ошибка:', err.response?.status, JSON.stringify(err.response?.data || err.message).slice(0, 500));
  process.exit(1);
});
