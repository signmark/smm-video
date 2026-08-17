/**
 * AI-123: кампания с отозванной сессией не должна пробовать вечно.
 *
 * ЧТО БЫЛО. У кампании токен по сроку живой, но Directus отвечает 403: сессия
 * отозвана на его стороне, а срок внутри токена об этом не знает. Обновить не
 * выходит — refresh-токен тоже мёртв. После AI-121 цикл честно прерывался и
 * планировал следующую попытку через обычный интервал. И так бесконечно: сама
 * по себе отозванная сессия не восстановится. При этом в интерфейсе режим всё
 * это время показан включённым, и человек ждёт постов, которых не будет.
 *
 * ПОЧЕМУ ИМЕННО ТРИ ПОДРЯД, а не одно. Одиночный сбой Directus не должен
 * выключать режим, который человек включил осознанно. Три прерывания подряд —
 * это уже не сбой, а состояние.
 *
 * ВНИМАНИЕ (правило 49). Первая часть — поведение чистых функций. Вторая —
 * сканер исходника: он стережёт места, где счётчик обнуляется и где причина
 * попадает наружу, но не доказывает поведение цикла целиком.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function src(): string {
  return readFileSync(join(__dirname, '../services/autonomous-ai.ts'), 'utf-8');
}

describe('AI-123: остановка наступает не с первого раза', () => {
  it('порог — три прерывания подряд', () => {
    const s = src();
    const m = s.match(/const MAX_CONSECUTIVE_ABORTED_CYCLES = (\d+);/);
    expect(m).not.toBeNull();
    const threshold = Number(m![1]);

    // Единица означала бы, что любой одиночный сбой Directus выключает режим,
    // который человек включил осознанно. Слишком большое значение означает
    // сутки бесполезных попыток при обычном интервале в несколько часов.
    expect(threshold).toBeGreaterThan(1);
    expect(threshold).toBeLessThanOrEqual(5);
  });

  it('счётчик считает ПОДРЯД: дошедший до конца цикл его обнуляет', () => {
    const s = src();
    const resetIdx = s.indexOf('state.consecutiveAbortedCycles = 0;');
    expect(resetIdx).toBeGreaterThan(0);

    // Обнуление должно стоять на пути завершённого цикла, рядом с учётом
    // выполненной работы. Без него счётчик копил бы разрозненные сбои за месяц
    // и однажды выключил бы исправно работающий режим.
    const around = s.slice(resetIdx, resetIdx + 300);
    expect(around).toContain('state.cyclesCompleted++');
  });
});

describe('AI-123: остановка настоящая, а не только отметка', () => {
  it('снимаются таймеры и убирается сохранённая копия состояния', () => {
    const s = src();
    const idx = s.indexOf('function stopAutonomousWithReason');
    expect(idx).toBeGreaterThan(0);
    const body = s.slice(idx, s.indexOf('\n}', idx));

    expect(body).toContain('clearInterval(state.timer)');
    expect(body).toContain('clearTimeout(state.firstCycleTimer)');
    expect(body).toContain('autonomousStates.delete(state.campaignId)');
    // Без удаления сохранённой копии режим воскреснет после перезапуска
    // процесса и продолжит биться в ту же стену.
    expect(body).toContain('deleteAutonomousPersistence(state.campaignId)');
    expect(body).toContain("'autonomous.stopped'");
  });

  it('причина остановки доходит до интерфейса', () => {
    const s = src();
    const idx = s.indexOf('export function getAutonomousStatusExternal');
    expect(idx).toBeGreaterThan(0);
    const body = s.slice(idx, idx + 1200);
    expect(body).toContain('stopReasonMap.get(campaignId)');
    expect(body).toContain('stopReason');
  });

  it('новый запуск режима снимает прежнюю причину', () => {
    const s = src();
    // Иначе человек включит режим заново и увидит объяснение вчерашней
    // остановки поверх работающего режима.
    expect(s).toContain('stopReasonMap.delete(params.campaignId)');
  });
});

describe('AI-123: текст для человека', () => {
  it('не содержит слов, с которыми человек ничего не может сделать', () => {
    const s = src();
    const idx = s.indexOf('function stopMessageForAbortReason');
    expect(idx).toBeGreaterThan(0);
    const body = s.slice(idx, s.indexOf('\n}', idx));

    // «Токен», «сессия», «403» человек не чинит — он от них только пугается.
    expect(body).not.toMatch(/'[^']*токен[^']*'/i);
    expect(body).not.toMatch(/'[^']*403[^']*'/);
    // Зато названо действие, которое человек выполняет сам.
    expect(body).toContain('войдите в систему заново');
  });

  it('у потери подключения и нечитаемых настроек разные объяснения', () => {
    const s = src();
    const idx = s.indexOf('function stopMessageForAbortReason');
    const body = s.slice(idx, s.indexOf('\n}', idx));
    expect(body).toContain('token_refresh_failed');
    expect(body).toContain('campaign_settings_unreadable');
    expect(body).toContain('Подключение к вашему аккаунту потеряно');
    expect(body).toContain('Не удаётся прочитать настройки кампании');
  });
});
