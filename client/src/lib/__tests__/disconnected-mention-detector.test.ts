/**
 * SM-18: разбор промта на упоминания неподключённых сетей.
 *
 * Главный тест здесь — последний: он открывает СЕРВЕРНЫЙ модуль подстановки и
 * требует, чтобы клиент и сервер опознавали ровно одни и те же названия.
 * Прошлая версия этого теста сравнивала два экспорта одного и того же
 * клиентского файла и потому не могла покраснеть никогда — при том что списки
 * уже разошлись: сервер знал `TikTok` и алиас `VK`, клиент не знал ни одного.
 */
import { describe, it, expect } from 'vitest';
import {
  extractUnconnectedMentions,
  extractPlatformMentions,
} from '@/lib/disconnected-mention-detector';
import { isNegatedBefore, PLATFORM_LITERAL_NAMES } from '@shared/social-platform-names';
import { CONNECTABLE_PLATFORMS } from '@/lib/platform-connection';

const NONE_CONNECTED = () => false;
const ALL_CONNECTED = () => true;

describe('isNegatedBefore', () => {
  it('видит отрицание прямо перед названием', () => {
    const text = 'Не используй Facebook';
    expect(isNegatedBefore(text, text.indexOf('Facebook'))).toBe(true);
  });

  it('видит «избегай»', () => {
    const text = 'Избегай Facebook';
    expect(isNegatedBefore(text, text.indexOf('Facebook'))).toBe(true);
  });

  it("видит английское don't", () => {
    const text = "don't use Facebook";
    expect(isNegatedBefore(text, text.indexOf('Facebook'))).toBe(true);
  });

  it('в нейтральном контексте отрицания нет', () => {
    const text = 'Пиши посты для Facebook';
    expect(isNegatedBefore(text, text.indexOf('Facebook'))).toBe(false);
  });

  it('отрицание не переходит через границу предложения', () => {
    const text = 'Не используй Instagram. Пиши в Facebook';
    expect(isNegatedBefore(text, text.indexOf('Facebook'))).toBe(false);
  });
});

describe('extractPlatformMentions', () => {
  it('находит названия в любом регистре', () => {
    expect(extractPlatformMentions('пиши в telegram и FACEBOOK')).toEqual(
      expect.arrayContaining(['telegram', 'facebook']),
    );
  });

  it('на пустом тексте молчит', () => {
    expect(extractPlatformMentions('')).toEqual([]);
    expect(extractPlatformMentions('просто текст без сетей')).toEqual([]);
  });

  it('одна платформа не повторяется, даже если названа дважды разными словами', () => {
    const found = extractPlatformMentions('Пиши в VK, то есть ВКонтакте');
    expect(found.filter((p) => p === 'vk')).toHaveLength(1);
  });

  it('название внутри другого слова упоминанием не считается', () => {
    // Раньше поиск шёл простым includes, и «мультитрединг» ловился как Threads.
    expect(extractPlatformMentions('обсудим threadsafe и вконтактерство')).toEqual([]);
  });
});

describe('extractUnconnectedMentions', () => {
  it('возвращает упомянутые и неподключённые', () => {
    expect(
      extractUnconnectedMentions({ prompt: 'Пиши в Telegram и Facebook', isConnected: NONE_CONNECTED }),
    ).toEqual(expect.arrayContaining(['telegram', 'facebook']));
  });

  it('подключённые не перечисляет', () => {
    expect(
      extractUnconnectedMentions({ prompt: 'Пиши в Telegram и Facebook', isConnected: ALL_CONNECTED }),
    ).toEqual([]);
  });

  it('отрицающий контекст предупреждение не вызывает', () => {
    expect(
      extractUnconnectedMentions({ prompt: 'Не используй Facebook', isConnected: NONE_CONNECTED }),
    ).toEqual([]);
  });

  it('смешанный текст: отрицательное молчит, положительное предупреждает', () => {
    expect(
      extractUnconnectedMentions({
        prompt: 'Избегай Facebook. Telegram основной.',
        isConnected: NONE_CONNECTED,
      }),
    ).toEqual(['telegram']);
  });

  it('положительное упоминание после отрицательного не теряется', () => {
    // Проверяется каждое вхождение, а не первое: «не используй Facebook»
    // в начале не должно заглушать прямую просьбу писать туда же ниже.
    expect(
      extractUnconnectedMentions({
        prompt: 'Не используй Facebook в заголовках. Основной канал — Facebook.',
        isConnected: NONE_CONNECTED,
      }),
    ).toEqual(['facebook']);
  });

  it('алиас VK работает наравне с «ВКонтакте»', () => {
    // Сервер знает оба написания; пока у клиента был свой список с одним
    // «ВКонтакте», пользователь, написавший «VK», предупреждения не получал.
    expect(extractUnconnectedMentions({ prompt: 'Постим в VK', isConnected: NONE_CONNECTED })).toEqual(['vk']);
    expect(
      extractUnconnectedMentions({ prompt: 'Постим в ВКонтакте', isConnected: NONE_CONNECTED }),
    ).toEqual(['vk']);
  });

  it('про TikTok молчит осознанно', () => {
    // TikTok есть на сервере, но в интерфейсе публикации его нет и подключить
    // его пользователю негде — предупреждение было бы вечным и бесполезным.
    expect(extractUnconnectedMentions({ prompt: 'Публикуй в TikTok', isConnected: NONE_CONNECTED })).toEqual([]);
    expect(CONNECTABLE_PLATFORMS).not.toContain('tiktok');
  });
});

describe('общий источник названий с сервером', () => {
  it('клиент и сервер опознают ровно одни и те же написания', async () => {
    // Открываем именно серверный модуль подстановки. Если он заведёт новое
    // название или потеряет старое, тест покраснеет — ради этого он и нужен.
    const serverModule = await import('../../../../server/services/social-prompt');
    const serverNames = Object.values(serverModule.PLATFORM_NAMES_RU as Record<string, string>);
    const sharedNames = PLATFORM_LITERAL_NAMES.map((p) => p.name);

    for (const name of serverNames) {
      expect(sharedNames).toContain(name);
    }
  });

  it('каждое написание из общего списка находится разбором промта', () => {
    for (const { key, name } of PLATFORM_LITERAL_NAMES) {
      expect(extractPlatformMentions(`Публикуй в ${name} ежедневно`)).toContain(key);
    }
  });
});
