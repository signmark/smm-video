import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolveCreatedCampaignId } from '../ai-chat-navigation';

/**
 * AI-78. Главное требование тикета: переход после создания кампании не должен
 * зависеть от формулировки ответа модели. Обычный тест это не ловит — он гоняет
 * фиксированную строку, на которой регулярное выражение всегда совпадает, и
 * остаётся зелёным ровно до того дня, когда ломается у пользователя.
 *
 * Поэтому проверяем не «совпало на этой строке», а инвариант: при ЛЮБОМ тексте
 * ответа результат один и тот же, пока структурное поле на месте.
 */

const ID = '46868c44-c6a4-4bed-accf-9ad07bba790e';

describe('AI-78: id созданной кампании берётся из данных, а не из текста', () => {
  it('одинаково работает при любой формулировке ответа', () => {
    const тексты = [
      `✅ **Кампания успешно создана!**\n\n📊 **ID:** ${ID}`,
      `🎉 Кампания настроена!\n• ID кампании: ${ID}`,
      'Campaign created successfully.',
      'Готово!',
      '',
    ];

    for (const response of тексты) {
      expect(resolveCreatedCampaignId({ ...{ response }, campaignId: ID } as any)).toBe(ID);
    }
  });

  it('читает обе формы, которые реально приходят с сервера', () => {
    // Путь ассистента: data.campaign от Directus (id может лежать на два уровня глубже).
    expect(resolveCreatedCampaignId({ data: { campaign: { data: { id: ID } } } })).toBe(ID);
    expect(resolveCreatedCampaignId({ data: { campaign: { id: ID } } })).toBe(ID);
    // Автономный сценарий: data.campaignId.
    expect(resolveCreatedCampaignId({ data: { campaignId: ID } })).toBe(ID);
    // Новое поле верхнего уровня.
    expect(resolveCreatedCampaignId({ campaignId: ID })).toBe(ID);
  });

  it('без структурного id возвращает null, даже если id есть в тексте', () => {
    // Это и есть смысл правки: текст перестал быть источником данных.
    const сТекстом = { response: `📊 **ID:** ${ID}` } as any;
    expect(resolveCreatedCampaignId(сТекстом)).toBeNull();

    expect(resolveCreatedCampaignId(null)).toBeNull();
    expect(resolveCreatedCampaignId(undefined)).toBeNull();
    expect(resolveCreatedCampaignId({})).toBeNull();
    expect(resolveCreatedCampaignId({ campaignId: '' })).toBeNull();
    expect(resolveCreatedCampaignId({ campaignId: '   ' })).toBeNull();
    expect(resolveCreatedCampaignId({ data: { campaign: null } })).toBeNull();
  });

  it('AIChat больше не разбирает текст ответа ради навигации', () => {
    const chat = readFileSync(resolve(__dirname, '../../components/AIChat.tsx'), 'utf-8');
    expect(chat).toContain('resolveCreatedCampaignId');
    // Проверяем КОД, а не комментарии: в пояснении рядом с правкой старая строка
    // упоминается намеренно, и запрет на неё срабатывал бы на объяснении.
    expect(chat).not.toMatch(/data\.response\.match\(/);
    expect(chat).not.toMatch(/response\.includes\(\s*['\"`]\S*ID кампании/);
    expect(chat).not.toMatch(/const idMatch/);
  });

  it('сервер отдаёт campaignId отдельным полем, а не только внутри текста', () => {
    const handlers = readFileSync(
      resolve(__dirname, '../../../../server/services/ai-assistant/command-handlers.ts'),
      'utf-8',
    );
    // Без этого поля клиентский хелпер на пути ассистента остался бы ни с чем.
    expect(handlers).toMatch(/campaignId,\s*\n\s*data: \{ campaign: campaignData \}/);
  });
});
