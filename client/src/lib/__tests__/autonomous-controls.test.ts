/**
 * SM-20, сторона интерфейса. Здесь сторожится ровно то, что нашёл тестировщик,
 * и то, чем это легко было бы заменить.
 *
 * Первое: клик по значку больше не выключает режим. Раньше выключал молча.
 * Второе: три действия существуют и различимы. Раньше пауза была безымянной
 * иконкой, а «Возобновить» и «Выключить» не существовали как явные кнопки.
 * Третье: пока запрос идёт, второе нажатие невозможно — иначе легко выключить
 * режим, целясь в паузу.
 */
import { describe, it, expect } from 'vitest';
import { autonomousControls, pauseResultToast } from '../autonomous-controls';

const idle = { pause: false, resume: false, disable: false };

describe('кнопки окна управления', () => {
  it('на ходу предлагают паузу и выключение, но не возобновление', () => {
    const c = autonomousControls({ active: true, phase: 'running', pending: idle });

    expect(c.pause.visible).toBe(true);
    expect(c.pause.disabled).toBe(false);
    expect(c.resume.visible).toBe(false);
    expect(c.disable.visible).toBe(true);
  });

  it('на паузе предлагают возобновление вместо паузы', () => {
    const c = autonomousControls({ active: true, phase: 'paused', pending: idle });

    expect(c.resume.visible).toBe(true);
    expect(c.resume.disabled).toBe(false);
    expect(c.pause.visible).toBe(false);
  });

  it('выключить можно и на ходу, и с паузы', () => {
    for (const phase of ['running', 'pausing', 'paused'] as const) {
      expect(autonomousControls({ active: true, phase, pending: idle }).disable.visible).toBe(true);
    }
  });

  it('пока цикл дорабатывает пост, пауза видна, но повторно не нажимается', () => {
    const c = autonomousControls({ active: true, phase: 'pausing', pending: idle });

    expect(c.pause.visible).toBe(true);
    expect(c.pause.disabled).toBe(true);
    expect(c.resume.visible).toBe(false);
  });

  it('идущий запрос выключает все кнопки разом', () => {
    // Иначе человек, целясь в паузу, попадает в выключение и теряет прогресс.
    const c = autonomousControls({ active: true, phase: 'running', pending: { pause: true } });

    expect(c.pause.disabled).toBe(true);
    expect(c.pause.busy).toBe(true);
    expect(c.disable.disabled).toBe(true);
    expect(c.disable.busy).toBe(false);
  });

  it('выключенный режим окна управления не показывает', () => {
    const c = autonomousControls({ active: false, phase: 'stopped', pending: idle });

    expect(c.pause.visible).toBe(false);
    expect(c.resume.visible).toBe(false);
    expect(c.disable.visible).toBe(false);
  });
});

describe('сообщение после паузы', () => {
  it('обычная пауза без снятых публикаций говорит только о паузе', () => {
    const toast = pauseResultToast('Режим на паузе', {
      success: true, message: 'Запланированных публикаций этого запуска не было', counts: { demoted: 0 },
    });

    expect(toast.description).toBe('Режим на паузе');
    expect(toast.variant).toBeUndefined();
  });

  it('снятые публикации называются числом', () => {
    const toast = pauseResultToast('Режим на паузе', {
      success: true, message: 'Снято с очереди публикаций: 3', counts: { demoted: 3 },
    });

    expect(toast.description).toContain('3');
  });

  it('«снято не всё» показывается тревожно, а не как успех', () => {
    // Ровно тот случай, ради которого пауза и нажималась: часть публикаций
    // осталась в очереди, и человек обязан узнать это сейчас.
    const toast = pauseResultToast('Режим на паузе', {
      success: false, message: 'Снято не всё — уже публикуется: 1', counts: { demoted: 0, busy: 1 },
    });

    expect(toast.variant).toBe('destructive');
    expect(toast.description).toContain('уже публикуется');
  });

  it('старый ответ сервера без отчёта не ломает сообщение', () => {
    expect(pauseResultToast('Режим на паузе', null).description).toBe('Режим на паузе');
    expect(pauseResultToast('Режим на паузе', {}).description).toBe('Режим на паузе');
  });
});
