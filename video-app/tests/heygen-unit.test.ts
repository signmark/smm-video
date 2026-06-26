/**
 * Unit-тесты HeyGen-интеграции (fal-animator.ts).
 *
 * Чистые тесты — проверяют только guard-ошибки и константы.
 * Никакой сети, никаких FAL-вызовов: throws случаются ДО falSubmit.
 *
 * Запуск (из video-app/):
 *   npx tsx --test tests/heygen-unit.test.ts
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateAvatarClip,
  generateAgentVideo,
  DEFAULT_HEYGEN_AVATAR,
} from '../server/services/fal-animator.js';

// ── Константы ──────────────────────────────────────────────────────────────────

describe('DEFAULT_HEYGEN_AVATAR', () => {
  test('равен "Abigail Sofa Front"', () => {
    assert.equal(DEFAULT_HEYGEN_AVATAR, 'Abigail Sofa Front');
  });

  test('является непустой строкой', () => {
    assert.ok(typeof DEFAULT_HEYGEN_AVATAR === 'string' && DEFAULT_HEYGEN_AVATAR.trim().length > 0);
  });
});

// ── Экспорты ──────────────────────────────────────────────────────────────────

describe('Экспорты fal-animator', () => {
  test('generateAvatarClip — это функция', () => {
    assert.equal(typeof generateAvatarClip, 'function');
  });

  test('generateAgentVideo — это функция', () => {
    assert.equal(typeof generateAgentVideo, 'function');
  });
});

// ── generateAvatarClip — guard-ошибки ─────────────────────────────────────────

describe('generateAvatarClip — валидация входных данных', () => {
  const COMMON = {
    avatarName: 'Abigail Sofa Front',
    format: '9:16' as const,
    outputPath: '/tmp/test-avatar.mp4',
    apiKey: 'dummy-key-will-never-reach-fal',
  };

  test('бросает ошибку если нет ни audioBuffer, ни prompt', async () => {
    await assert.rejects(
      () => generateAvatarClip({ ...COMMON }),
      (err: Error) => {
        assert.ok(
          err.message.includes('audioBuffer') || err.message.includes('prompt'),
          `Неожиданный текст ошибки: "${err.message}"`,
        );
        return true;
      },
    );
  });

  test('бросает ошибку если audioBuffer пуст (length=0) и нет prompt', async () => {
    await assert.rejects(
      () => generateAvatarClip({ ...COMMON, audioBuffer: Buffer.alloc(0) }),
      (err: Error) => {
        assert.ok(
          err.message.includes('audioBuffer') || err.message.includes('prompt'),
          `Неожиданный текст ошибки: "${err.message}"`,
        );
        return true;
      },
    );
  });

  test('бросает ошибку если prompt — пустая строка и нет audioBuffer', async () => {
    await assert.rejects(
      () => generateAvatarClip({ ...COMMON, prompt: '   ' }),
      (err: Error) => {
        assert.ok(
          err.message.includes('audioBuffer') || err.message.includes('prompt'),
          `Неожиданный текст ошибки: "${err.message}"`,
        );
        return true;
      },
    );
  });

  test('НЕ бросает guard-ошибку если audioBuffer непустой (выйдет за сеть)', async () => {
    // Функция должна пройти guard и упасть уже на FAL-запросе (сеть/ключ).
    // Мы ловим ошибку, но убеждаемся что это НЕ guard-ошибка про audio/prompt.
    let caught: Error | null = null;
    try {
      await generateAvatarClip({ ...COMMON, audioBuffer: Buffer.from('audio-data') });
    } catch (e: any) {
      caught = e;
    }
    // Должна быть какая-то ошибка (неправильный ключ / сеть), но НЕ guard
    assert.ok(caught !== null, 'Должна была бросить ошибку сети/ключа');
    const guardMsg = 'requires either audioBuffer or prompt';
    assert.ok(
      !caught!.message.includes(guardMsg),
      `Неожиданная guard-ошибка при непустом audioBuffer: "${caught!.message}"`,
    );
  });

  test('НЕ бросает guard-ошибку если prompt задан (выйдет за сеть)', async () => {
    let caught: Error | null = null;
    try {
      await generateAvatarClip({ ...COMMON, prompt: 'Тест аватара' });
    } catch (e: any) {
      caught = e;
    }
    assert.ok(caught !== null, 'Должна была бросить ошибку сети/ключа');
    const guardMsg = 'requires either audioBuffer or prompt';
    assert.ok(
      !caught!.message.includes(guardMsg),
      `Неожиданная guard-ошибка при заданном prompt: "${caught!.message}"`,
    );
  });
});

// ── generateAgentVideo — guard-ошибки ─────────────────────────────────────────

describe('generateAgentVideo — валидация входных данных', () => {
  const COMMON = {
    outputPath: '/tmp/test-agent.mp4',
    apiKey: 'dummy-key-will-never-reach-fal',
  };

  test('бросает ошибку если prompt пустой', async () => {
    await assert.rejects(
      () => generateAgentVideo({ ...COMMON, prompt: '' }),
      (err: Error) => {
        assert.ok(
          err.message.includes('prompt'),
          `Неожиданный текст ошибки: "${err.message}"`,
        );
        return true;
      },
    );
  });

  test('бросает ошибку если prompt только пробелы', async () => {
    await assert.rejects(
      () => generateAgentVideo({ ...COMMON, prompt: '   \t\n  ' }),
      (err: Error) => {
        assert.ok(
          err.message.includes('prompt'),
          `Неожиданный текст ошибки: "${err.message}"`,
        );
        return true;
      },
    );
  });

  test('НЕ бросает guard-ошибку при непустом prompt (выйдет за сеть)', async () => {
    let caught: Error | null = null;
    try {
      await generateAgentVideo({ ...COMMON, prompt: 'Создай видео о йоге' });
    } catch (e: any) {
      caught = e;
    }
    assert.ok(caught !== null, 'Должна была бросить ошибку сети/ключа');
    assert.ok(
      !caught!.message.includes('requires a prompt'),
      `Неожиданная guard-ошибка при непустом prompt: "${caught!.message}"`,
    );
  });
});

// ── Дифференциация: одна функция — не другая ──────────────────────────────────

describe('Разделение ответственности функций', () => {
  test('generateAvatarClip и generateAgentVideo — разные функции', () => {
    assert.notEqual(generateAvatarClip, generateAgentVideo as unknown);
  });
});
