/**
 * Запуск промо-видео на продакшне.
 * Использует Seedance 2.0 I2V (новая модель) + субтитры fade-zoom (новая фича).
 *
 * Запуск:
 *   VIDEO_E2E_URL=https://smm.omemo.tech/video-app/api npx tsx e2e/run-promo.ts
 */

const BASE_URL = process.env.VIDEO_E2E_URL ?? 'https://smm.omemo.tech/video-app/api';

async function api<T = any>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ status: number; body: T }> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json as T };
}

async function poll<T>(path: string, until: (v: T) => boolean, timeoutMs: number, label: string): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { body } = await api<T>('GET', path);
    if (until(body)) return body;
    const elapsed = Math.round((Date.now() - start) / 1000);
    process.stdout.write(`\r  ⏳ ${label}: ${elapsed}с...`);
    await new Promise(r => setTimeout(r, 4000));
  }
  throw new Error(`Таймаут (${timeoutMs / 1000}с): ${label}`);
}

async function main() {
  const CFG = {
    title:          'Промо: Премиальный кофе BRIO',
    topic:          'Премиальный кофе для ценителей: от зерна до идеальной чашки',
    format:         '9:16' as const,
    duration:       30,
    language:       'ru',
    animationModel: 'seedance2',   // новая модель Seedance 2.0
    subtitleStyle:  'fade-zoom',   // новая фича субтитров
  };

  console.log('\n🎬 Запуск промо-генерации на продакшне');
  console.log(`   Модель:    ${CFG.animationModel}`);
  console.log(`   Субтитры:  ${CFG.subtitleStyle}`);
  console.log(`   Формат:    ${CFG.format}, ${CFG.duration}с`);
  console.log(`   Тема:      ${CFG.topic}\n`);

  // 1. Создаём проект
  const { status: sCreate, body: project } = await api('POST', '/videos', CFG);
  if (sCreate !== 201) throw new Error(`Создание провалилось (${sCreate}): ${JSON.stringify(project)}`);
  const id = (project as any).id;
  console.log(`✅ Проект создан: ${id}`);

  // 2. Генерируем скрипт
  const { status: sScript } = await api('POST', `/videos/${id}/generate-script`, {});
  if (![200, 202].includes(sScript)) throw new Error(`generate-script вернул ${sScript}`);
  console.log('📝 Генерация скрипта запущена...');

  // 3. Ждём stock precheck
  await poll<any>(
    `/videos/${id}`,
    p => p.script?.stockPrechecked === true,
    3 * 60 * 1000,
    'скрипт + precheck',
  );
  console.log('\n✅ Скрипт и stock precheck готовы');

  // 4. Показываем сцены
  const { body: afterScript } = await api<any>('GET', `/videos/${id}`);
  const scenes = afterScript?.script?.scenes ?? [];
  console.log(`\n📋 Сцен: ${scenes.length}`);
  scenes.forEach((s: any, i: number) => {
    const src = s.videoSource === 'stock' ? '🎞️ stock' : '🤖 AI';
    console.log(`   ${i + 1}. [${src}] ${(s.text ?? '').slice(0, 60)}`);
  });

  // 5. Запускаем генерацию
  const { status: sGen } = await api('POST', `/videos/${id}/generate`, {});
  if (![200, 202].includes(sGen)) throw new Error(`generate вернул ${sGen}`);
  console.log('\n🚀 Генерация видео запущена...');

  // 6. Ждём завершения (до 15 мин)
  const done = await poll<any>(
    `/videos/${id}`,
    p => p.status === 'done' || p.status === 'error',
    15 * 60 * 1000,
    'генерация клипов + сборка',
  );

  console.log('');
  if (done.status === 'error') {
    console.error(`❌ Ошибка генерации: ${done.error ?? '(нет деталей)'}`);
    process.exit(1);
  }

  console.log('✅ Генерация завершена!');
  console.log(`\n🔗 Скачать MP4:   ${BASE_URL}/videos/${id}/download`);
  console.log(`🔗 Просмотр UI:   https://smm.omemo.tech/video-app/videos/${id}\n`);
}

main().catch(err => {
  console.error('\n❌', err.message ?? err);
  process.exit(1);
});
