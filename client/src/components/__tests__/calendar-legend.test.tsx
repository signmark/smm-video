/**
 * AI-116: легенда обязана совпадать с фактическим поведением маркеров.
 *
 * Смысл этих проверок не в том, что «легенда отрисовалась», а в том, что она
 * собрана из тех же констант, что и маркеры. Легенда, набранная отдельными
 * литералами, при первой же правке цвета начинает врать — и врать
 * авторитетно, потому что выглядит как документация.
 *
 * Красный-до: компонента не было вовсе, договорённость о цветах жила только
 * в коде.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CalendarLegend } from '@/components/CalendarLegend';
import {
  FAILED_PUBLICATION_DOT_COLOR,
  MEDIA_KIND_DOT_COLOR,
} from '@/lib/calendar-dot-color';

describe('AI-116: легенда календаря', () => {
  it('красный подписан как ошибка, и только как ошибка', () => {
    render(<CalendarLegend />);
    const failed = screen.getByTestId('calendar-legend-failed');
    expect(failed).toHaveTextContent('не опубликовалось');
    expect(failed.querySelector('span')?.className).toContain(FAILED_PUBLICATION_DOT_COLOR);
  });

  it('цвет каждого рода содержимого в легенде тот же, что у маркера', () => {
    render(<CalendarLegend />);
    (['video', 'image', 'text'] as const).forEach((kind) => {
      const item = screen.getByTestId(`calendar-legend-${kind}`);
      expect(item.querySelector('span')?.className).toContain(MEDIA_KIND_DOT_COLOR[kind]);
    });
  });

  it('красный не используется ни одним родом содержимого', () => {
    // Суть решения от 16.08: тревожный цвет принадлежит только ошибке.
    expect(Object.values(MEDIA_KIND_DOT_COLOR)).not.toContain(FAILED_PUBLICATION_DOT_COLOR);
  });

  it('на календаре без неудач строку про ошибку можно убрать', () => {
    render(<CalendarLegend withFailed={false} />);
    expect(screen.queryByTestId('calendar-legend-failed')).toBeNull();
    expect(screen.getByTestId('calendar-legend-video')).toBeInTheDocument();
  });
});
