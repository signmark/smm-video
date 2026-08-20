/**
 * SM-20, сторона интерфейса. Состояния окна управления автономным режимом.
 *
 * До этой правки клик по значку активного режима сразу выключал его: ни окна,
 * ни подтверждения, ни возможности просто поставить на паузу. Человек, который
 * хотел поправить настройки, терял прогресс — счётчики циклов и постов
 * обнулялись, потому что выключение стирает состояние.
 *
 * Правила состояний собраны здесь, а не в разметке, по одной причине: их надо
 * проверять. В разметке они проверяются только глазами, и «кнопка активна не
 * тогда, когда надо» — ровно та ошибка, которую глазами и пропускают.
 */

export type AutonomousPhase = 'running' | 'pausing' | 'paused' | 'stopped';

export interface ControlsInput {
  /** Режим заведён: без этого окна управления вообще нет. */
  active: boolean;
  phase: AutonomousPhase;
  /** Идёт ли прямо сейчас соответствующий запрос. */
  pending: { pause?: boolean; resume?: boolean; disable?: boolean };
}

export interface ControlButton {
  visible: boolean;
  disabled: boolean;
  busy: boolean;
}

export interface Controls {
  pause: ControlButton;
  resume: ControlButton;
  disable: ControlButton;
}

/**
 * Пауза и возобновление — одно место, а не две кнопки рядом: показывается ровно
 * та, которая сейчас имеет смысл. Иначе человек видит две кнопки, из которых
 * одна всегда мертва, и гадает, что именно с ней не так.
 *
 * Промежуточное состояние «останавливаюсь» — это когда цикл ещё дорабатывает
 * начатый пост. Тогда пауза уже нажата, и повторное нажатие ничего не даст, а
 * возобновление до фактической остановки только запутает.
 */
export function autonomousControls(input: ControlsInput): Controls {
  const { active, phase } = input;
  const anyPending = Boolean(input.pending.pause || input.pending.resume || input.pending.disable);

  if (!active) {
    const hidden: ControlButton = { visible: false, disabled: true, busy: false };
    return { pause: hidden, resume: { ...hidden }, disable: { ...hidden } };
  }

  const paused = phase === 'paused';
  const pausing = phase === 'pausing';

  return {
    pause: {
      visible: !paused,
      // Во время остановки цикла кнопка видна, но нажимать её больше нечем.
      disabled: pausing || anyPending,
      busy: Boolean(input.pending.pause),
    },
    resume: {
      visible: paused,
      disabled: anyPending,
      busy: Boolean(input.pending.resume),
    },
    disable: {
      // Выключить можно в любом состоянии: и на ходу, и с паузы.
      visible: true,
      disabled: anyPending,
      busy: Boolean(input.pending.disable),
    },
  };
}

/** Ответ сервера на паузу или выключение — в части снятия публикаций с очереди. */
export interface DemotionReport {
  success?: boolean;
  message?: string;
  counts?: { demoted?: number; busy?: number; contested?: number; failed?: number };
}

/**
 * Что показать человеку после паузы или выключения.
 *
 * Главное правило: «снято не всё» нельзя показывать как обычный успех. Человек
 * поставил паузу именно для того, чтобы ничего не вышло; если часть публикаций
 * увели или они уже отправляются, он должен узнать об этом сразу, а не увидеть
 * вышедший пост через час.
 */
export function pauseResultToast(
  base: string,
  report: DemotionReport | null | undefined,
): { description: string; variant?: 'destructive' } {
  if (!report || typeof report.message !== 'string' || report.message.length === 0) {
    return { description: base };
  }
  if (report.success === false) {
    return { description: `${base}. ${report.message}`, variant: 'destructive' };
  }
  const demoted = report.counts?.demoted ?? 0;
  // Про «ничего не было» молчим: это не новость, а шум в обычном случае.
  if (demoted === 0) return { description: base };
  return { description: `${base}. ${report.message}` };
}
