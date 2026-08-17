/**
 * AI-70: блокирующая проверка уязвимостей в production-дереве.
 *
 * Зачем нужен список исключений, а не просто «пусть падает». Не всякую находку
 * можно починить обновлением: бывает, что исправления не существует вовсе.
 * Проверка без возможности принять такую находку нежизнеспособна — её отключат
 * в первый же день, и она перестанет ловить настоящие новые уязвимости. Ровно
 * это и произошло: шаг аудита добавили отчётным (continue-on-error), потому что
 * блокирующий покрасил бы всё и сразу.
 *
 * Зачем у исключений сроки. Список исключений без сроков за полгода превращается
 * в свалку, куда добавляют, но откуда не убирают. Просроченная запись красит
 * гейт так же, как непринятая находка: единственный надёжный способ заставить
 * вернуться к решению — сделать возврат обязательным.
 *
 * Зачем ругаться на УСТАРЕВШИЕ исключения. Если пакет обновили или выкинули, а
 * запись осталась, список начинает описывать несуществующий мир — и следующий
 * человек уже не понимает, что из перечисленного правда. Поэтому запись, под
 * которую больше нет находки, тоже считается ошибкой.
 *
 * Логика вынесена в чистую функцию: приговор надо проверять тестами, не запуская
 * npm audit и не выходя в сеть.
 */

/** Находка в том виде, в каком её отдаёт `npm audit --json`. */
export interface AuditFinding {
  package: string;
  severity: 'info' | 'low' | 'moderate' | 'high' | 'critical';
}

export interface AuditException {
  package: string;
  severity: string;
  why: string;
  mitigation: string;
  accepted_by: string;
  accepted_on: string;
  /** ГГГГ-ММ-ДД. После этой даты запись считается просроченной. */
  review_by: string;
}

export interface AuditProblem {
  kind: 'unaccepted' | 'expired' | 'stale' | 'malformed';
  package: string;
  message: string;
}

export interface AuditVerdict {
  ok: boolean;
  problems: AuditProblem[];
  /** Находки, честно закрытые действующим исключением. */
  accepted: string[];
}

const BLOCKING: Array<AuditFinding['severity']> = ['high', 'critical'];

/** Обязательные поля исключения. Запись без любого из них бессмысленна:
 *  она принимает риск, не объясняя ни причины, ни того, чем он закрыт. */
const REQUIRED_FIELDS: Array<keyof AuditException> = [
  'package',
  'severity',
  'why',
  'mitigation',
  'accepted_by',
  'accepted_on',
  'review_by',
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Приговор проверки.
 *
 * `today` передаётся снаружи, а не берётся из системных часов: иначе тест на
 * просроченную запись начал бы зависеть от дня запуска и однажды сломался бы сам.
 */
export function decideAuditGate(
  findings: AuditFinding[],
  exceptions: AuditException[],
  today: string,
): AuditVerdict {
  const problems: AuditProblem[] = [];
  const accepted: string[] = [];

  for (const ex of exceptions) {
    const missing = REQUIRED_FIELDS.filter((f) => !ex?.[f] || String(ex[f]).trim() === '');
    if (missing.length > 0) {
      problems.push({
        kind: 'malformed',
        package: ex?.package || '(без имени)',
        message: `в исключении не заполнено: ${missing.join(', ')}. Исключение обязано объяснять, что принято и чем закрыт риск.`,
      });
      continue;
    }
    if (!DATE_RE.test(ex.review_by) || !DATE_RE.test(ex.accepted_on)) {
      problems.push({
        kind: 'malformed',
        package: ex.package,
        message: 'даты accepted_on и review_by должны быть в формате ГГГГ-ММ-ДД.',
      });
    }
  }

  const usable = exceptions.filter(
    (ex) => REQUIRED_FIELDS.every((f) => ex?.[f] && String(ex[f]).trim() !== ''),
  );

  const blocking = findings.filter((f) => BLOCKING.includes(f.severity));

  for (const finding of blocking) {
    const ex = usable.find((e) => e.package === finding.package);
    if (!ex) {
      problems.push({
        kind: 'unaccepted',
        package: finding.package,
        message: `уязвимость уровня ${finding.severity} не принята. Обновите пакет либо внесите запись в security-audit-exceptions.json с причиной, мерой закрытия риска и сроком пересмотра.`,
      });
      continue;
    }
    // Сравнение строк ГГГГ-ММ-ДД работает как сравнение дат и не зависит от
    // часового пояса — в отличие от разбора в Date.
    if (ex.review_by < today) {
      problems.push({
        kind: 'expired',
        package: finding.package,
        message: `срок пересмотра истёк ${ex.review_by}. Проверьте, не появилось ли исправление, и либо обновите пакет, либо продлите срок с новым обоснованием.`,
      });
      continue;
    }
    accepted.push(finding.package);
  }

  const blockingPackages = new Set(blocking.map((f) => f.package));
  for (const ex of usable) {
    if (!blockingPackages.has(ex.package)) {
      problems.push({
        kind: 'stale',
        package: ex.package,
        message: 'находки под это исключение больше нет — удалите запись, иначе список перестанет описывать действительность.',
      });
    }
  }

  return { ok: problems.length === 0, problems, accepted };
}

/**
 * Разбор отчёта `npm audit --json`.
 *
 * Формат npm 7+: объект `vulnerabilities`, ключ — имя пакета. Пакет попадает в
 * отчёт и как прямая находка, и как пострадавший от зависимости; нас интересует
 * поле severity верхнего уровня, оно уже учитывает худший случай.
 */
export function parseNpmAuditJson(raw: string): AuditFinding[] {
  const parsed = JSON.parse(raw);
  const vulns = parsed?.vulnerabilities;
  if (!vulns || typeof vulns !== 'object') return [];
  return Object.entries(vulns).map(([name, v]: [string, any]) => ({
    package: name,
    severity: v?.severity ?? 'info',
  }));
}

/** Человекочитаемый отчёт. Печатается и при провале, и при успехе: молчаливый
 *  зелёный шаг не даёт понять, что именно принято и до какого срока. */
export function formatVerdict(verdict: AuditVerdict, exceptions: AuditException[]): string {
  const lines: string[] = [];
  if (verdict.accepted.length > 0) {
    lines.push('Принятые уязвимости (действующие исключения):');
    for (const name of verdict.accepted) {
      const ex = exceptions.find((e) => e.package === name);
      lines.push(`  ${name} — пересмотр до ${ex?.review_by}, принял: ${ex?.accepted_by}`);
      lines.push(`    чем закрыт риск: ${ex?.mitigation}`);
    }
  }
  if (verdict.ok) {
    lines.push('Аудит production-дерева пройден: непринятых уязвимостей уровня high и выше нет.');
    return lines.join('\n');
  }
  lines.push('');
  lines.push('Аудит production-дерева НЕ пройден:');
  for (const p of verdict.problems) {
    lines.push(`  [${p.kind}] ${p.package}: ${p.message}`);
  }
  return lines.join('\n');
}
