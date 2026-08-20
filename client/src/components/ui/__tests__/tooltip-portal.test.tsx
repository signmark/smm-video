/**
 * SM-43: подсказка в свёрнутом меню пряталась за карточками.
 *
 * Корень: TooltipContent рендерился БЕЗ портала — то есть внутри дерева
 * боковой панели (`fixed` + stacking context), и его `z-50` не поднимался выше
 * соседних карточек главной области. Стандарт shadcn — оборачивать Tooltip
 * Content в Portal, чтобы подсказка уезжала на уровень document.body и `z-50`
 * работал относительно всего документа, а не вложенного контекста наложения.
 *
 * Здесь проверяется сам факт портала: открытый тултип обязан быть в
 * document.body, а не вложен в контейнер триггера (иначе баг вернётся).
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '../tooltip';

describe('SM-43: TooltipContent рендерится в портале (document.body)', () => {
  it('открытый тултип уезжает в document.body, а не живёт внутри контейнера триггера', async () => {
    const { container } = render(
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" data-testid="trigger">пункт</button>
          </TooltipTrigger>
          <TooltipContent data-testid="tooltip-content">Подсказка</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    );

    // Открываем тултип наведением (Radix) — fireEvent mouseenter на триггер.
    fireEvent.mouseEnter(screen.getByTestId('trigger'));
    fireEvent.focus(screen.getByTestId('trigger'));

    // Дожидаемся появления контента в DOM.
    const content = await screen.findByTestId('tooltip-content');
    expect(content.textContent).toContain('Подсказка');

    // Контент НЕ вложен в контейнер рендера — он в document.body (портал).
    expect(container.contains(content)).toBe(false);
    expect(document.body.contains(content)).toBe(true);
  });
});
