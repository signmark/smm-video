import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * SM-25: введённый запрос не должен исчезать после генерации текста.
 *
 * Почему сторож по тексту файла, а не поведенческий тест. Очистка живёт внутри
 * `handleGenerateAiText` — функции, объявленной прямо в теле `ContentPage`.
 * Экспортировать её нельзя, а поднимать всю страницу — это десятки запросов и
 * моков, которые ломаются от правки соседнего экрана; такой тест дороже
 * защищаемого им поведения и гниёт быстрее.
 *
 * Поэтому проверяется ровно то, что и было дефектом: где в файле стоит очистка
 * поля запроса. Тест честно ограничен — он не доказывает, что интерфейс ведёт
 * себя правильно; он ловит возврат конкретной строки в конкретное место.
 * Тот же приём уже применяется в `telegram-transport-coverage.test.ts`.
 */
const PAGE = resolve(__dirname, '../../pages/content/index.tsx');

/**
 * Комментарии выкусываются целыми строками. Иначе сторож считает упоминание
 * `setAiPromptText('')` в поясняющем комментарии за вызов — в этом файле такой
 * комментарий как раз есть, и он должен там остаться. Строки не удаляются, а
 * опустошаются: номера строк в файле и в проверяемом тексте совпадают.
 */
function stripCommentLines(src: string): string {
  return src
    .split('\n')
    .map(line => (/^\s*(\/\/|\/\*|\*)/.test(line) ? '' : line))
    .join('\n');
}

describe('SM-25: запрос переживает генерацию', () => {
  const code = stripCommentLines(readFileSync(PAGE, 'utf8'));
  const CLEAR = /setAiPromptText\(\s*(''|"")\s*\)/g;
  const PANEL_CLOSE = 'setShowAiPanel(false)';

  it('поле запроса очищается ровно в одном месте', () => {
    expect(code.match(CLEAR) ?? []).toHaveLength(1);
  });

  it('единственная очистка — сброс формы создания контента, а не генерация', () => {
    const at = code.search(CLEAR);
    expect(at).toBeGreaterThan(-1);

    // Сравниваем по ближайшему предшествующему маркеру, а не по окну в N
    // символов: окно зависит от длины соседнего кода и краснеет от чужих правок.
    const before = code.slice(0, at);
    const reset = before.lastIndexOf('setNewContent(');
    const generation = before.lastIndexOf(PANEL_CLOSE);

    expect(reset).toBeGreaterThan(-1);
    expect(reset).toBeGreaterThan(generation);
  });

  it('после закрытия панели генерации запрос не стирается', () => {
    let from = code.indexOf(PANEL_CLOSE);
    expect(from).toBeGreaterThan(-1);

    while (from !== -1) {
      const tail = code.slice(from, from + 400);
      expect(tail).not.toMatch(/setAiPromptText\(\s*(''|"")\s*\)/);
      from = code.indexOf(PANEL_CLOSE, from + 1);
    }
  });
});
