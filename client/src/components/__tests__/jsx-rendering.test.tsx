/**
 * AI-107: regression-тест на инфраструктуру JSX-рендеринга в vitest.
 *
 * Зачем нужен: до AI-107 в этом репо `tsconfig.json` имел `jsx: "preserve"`,
 * а `vitest.config.ts` не имел верхнего `react()` плагина. В результате
 * `import` ЛЮБОГО файла с JSX из vitest-теста падал с parse-ошибкой
 * `vite:import-analysis`, и единственный способ протестировать компонент
 * был писать его через `createElement` (см. `calendar-day-dots.tsx`
 * до AI-107). Этот тест — постоянный страж: если кто-то откатит
 * `jsx: "react-jsx"` в tsconfig.json или уберёт `plugins: [react()]`
 * из vitest.config.ts, тест ниже упадёт с parse-ошибкой.
 *
 * RED-BEFORE: на main без AI-107 этот тест падает с
 * `Failed to parse source for import analysis` на строке `import`.
 * После AI-107 — зелёный.
 *
 * Acceptance из PM-постановки (task #43):
 * - «реальный JSX-компонент падает parse-ошибкой» в red-before,
 * - «обычный JSX» в green.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
// Реальный компонент с JSX, не createElement. До AI-107 этот импорт
// валил vitest на parse-этапе.
import { CalendarDayDots } from '@/components/calendar-day-dots';

describe('AI-107: vitest может рендерить реальный JSX-компонент', () => {
  it('импорт и рендер CalendarDayDots не падают на parse-этапе', () => {
    // До AI-107: «Failed to parse source for import analysis» на строке
    // импорта CalendarDayDots, потому что в .tsx есть JSX, а vitest
    // не знает как его трансформировать.
    // После AI-107: импорт успешен, рендер работает, query по data-testid
    // находит элемент.
    const dots = [
      { key: 'a', color: 'bg-blue-500' },
      { key: 'b', color: 'bg-red-500' },
    ];
    render(<CalendarDayDots dots={dots} />);
    // data-testid ставится в самом компоненте — это и есть
    // доказательство, что мы отрендерили CalendarDayDots (а не createElement-обёртку).
    const dot = screen.getAllByTestId('calendar-day-dot');
    expect(dot).toHaveLength(2);
  });

  it('JSX со spread-атрибутами (props.children) корректно рендерится', () => {
    function Wrapper({ children }: { children: React.ReactNode }) {
      return <div data-testid="jsx-wrapper">{children}</div>;
    }
    render(
      <Wrapper>
        <span data-testid="child">hi</span>
      </Wrapper>,
    );
    expect(screen.getByTestId('jsx-wrapper')).toBeInTheDocument();
    expect(screen.getByTestId('child')).toBeInTheDocument();
  });

  it('цикл с JSX внутри (map → JSX) работает', () => {
    const items = ['one', 'two', 'three'];
    render(
      <ul data-testid="jsx-list">
        {items.map((it) => (
          <li key={it} data-testid={`item-${it}`}>
            {it}
          </li>
        ))}
      </ul>,
    );
    expect(screen.getByTestId('item-one')).toHaveTextContent('one');
    expect(screen.getByTestId('item-two')).toHaveTextContent('two');
    expect(screen.getByTestId('item-three')).toHaveTextContent('three');
  });
});
