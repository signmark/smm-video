/**
 * AI-122: предупреждение о лимите должно срабатывать по САМОМУ лимиту, а не по
 * названию тарифа.
 *
 * ЧТО БЫЛО. Проверка перед открытием диалога генерации стояла только для тарифа
 * basic. Пробный тариф (лимит 10 в месяц) её не проходил: диалог открывался,
 * человек писал запрос, ждал генерации — и упирался в отказ уже в конце. Именно
 * так это и выглядело у тестировщика, который после этого пошёл к владельцу
 * продукта.
 *
 * ВНИМАНИЕ (правило 49). Это сканер исходника: он не доказывает поведение
 * интерфейса. Он стережёт ровно одно — что условие снова не привяжут к названию
 * тарифа, и что в отказе остаётся действие, а не только текст.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function contentPage(): string {
  return readFileSync(join(__dirname, '../pages/content/index.tsx'), 'utf-8');
}

function dialog(): string {
  return readFileSync(join(__dirname, '../components/ImageGenerationDialog.tsx'), 'utf-8');
}

describe('AI-122: проверка лимита не привязана к названию тарифа', () => {
  it('условие смотрит на лимит, а не на слово basic', () => {
    const s = contentPage();
    const idx = s.indexOf("title: 'Лимит генераций исчерпан'");
    expect(idx).toBeGreaterThan(0);

    // Берём условие, стоящее непосредственно перед этим уведомлением.
    const head = s.slice(Math.max(0, idx - 700), idx);
    expect(head).toContain('imageGenUsage.limit !== null');
    // Новый тариф с лимитом не должен требовать правки этого условия руками.
    expect(head).not.toContain("effectivePlan === 'basic'");
  });

  it('в отказе есть действие, а не только текст', () => {
    const s = contentPage();
    const idx = s.indexOf("title: 'Лимит генераций исчерпан'");
    const tail = s.slice(idx, idx + 800);
    expect(tail).toContain('ToastAction');
    expect(tail).toContain("navigate('/pricing')");
  });
});

describe('AI-122: отказ сервера по лимиту тоже даёт действие', () => {
  it('диалог отличает отказ по лимиту от прочих ошибок генерации', () => {
    const s = dialog();
    // Без этого различия кнопка «Запросить повышение» появлялась бы на любой
    // ошибке генерации, включая недоступность модели, — и вводила бы в
    // заблуждение: повышение тарифа там ничего не решает.
    expect(s).toContain('response?.data?.limitExceeded');
    const idx = s.indexOf('const limitExceeded =');
    expect(idx).toBeGreaterThan(0);
    const tail = s.slice(idx, idx + 900);
    expect(tail).toContain('ToastAction');
    expect(tail).toContain("navigate('/pricing')");
  });
});
