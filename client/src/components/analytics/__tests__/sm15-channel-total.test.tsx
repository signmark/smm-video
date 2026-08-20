/**
 * SM-15: разложение должно читаться и на телефоне.
 *
 * ЧТО НАШЁЛ ВЛАДЕЛЕЦ 19.08: «на телефоне не вижу всплывающее сообщение».
 * Подсказка жила в атрибуте title, а наведения курсора на телефоне не
 * существует — то есть на телефоне объяснения не было вовсе. Ради него всё и
 * делалось.
 *
 * Здесь проверяется именно доступность объяснения нажатием, а не вёрстка.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, any>) => {
      const dictionary: Record<string, string> = {
        'analytics.channelValue': 'весь канал: {{value}}',
        'analytics.channelHint': 'Первое число — публикации кампании.',
        'analytics.channelBreakdownIntro': 'Из чего складывается число по каналу:',
        'analytics.channelBreakdownOwn': '{{value}} — эта кампания «{{name}}»',
        'analytics.channelBreakdownOther': '{{value}} — кампания «{{name}}»',
        'analytics.channelBreakdownUnattributed': '{{value}} — публикации без привязки',
      };
      const template = dictionary[key] ?? key;
      return Object.entries(vars || {}).reduce(
        (text, [name, value]) => text.replace(`{{${name}}}`, String(value)),
        template,
      );
    },
  }),
}));

import { ChannelTotal } from '@/components/analytics/ChannelTotal';

const ATTRIBUTION = {
  campaignName: 'Летняя',
  own: { posts: 3, views: 100, likes: 5, comments: 2, shares: 1 },
  others: [
    { campaignId: 'a', name: 'Осенняя', posts: 2, views: 40, likes: 0, comments: 0, shares: 0 },
  ],
  unattributed: { posts: 1, views: 7, likes: 0, comments: 0, shares: 0 },
};

describe('SM-15: вторая цифра объясняет себя нажатием', () => {
  it('нажатие открывает разложение по кампаниям', async () => {
    render(<ChannelTotal own={100} channel={147} metric="views" attribution={ATTRIBUTION} />);
    const user = userEvent.setup();

    await user.click(screen.getByTestId('channel-total'));

    const lines = await screen.findAllByTestId('channel-total-line');
    expect(lines.map(line => line.textContent)).toEqual([
      '100 — эта кампания «Летняя»',
      '40 — кампания «Осенняя»',
      '7 — публикации без привязки',
    ]);
  });

  it('без разложения нажатие показывает общее объяснение, а не пустоту', async () => {
    render(<ChannelTotal own={100} channel={147} metric="views" />);
    const user = userEvent.setup();

    await user.click(screen.getByTestId('channel-total'));

    expect(await screen.findByText('Первое число — публикации кампании.')).toBeInTheDocument();
  });

  it('цифра — кнопка, а не просто текст: иначе на телефоне по ней не нажать', () => {
    render(<ChannelTotal own={100} channel={147} metric="views" attribution={ATTRIBUTION} />);

    const trigger = screen.getByTestId('channel-total');
    expect(trigger.tagName).toBe('BUTTON');
    // Объяснение доступно и с клавиатуры, и программе чтения с экрана.
    expect(trigger).toHaveAttribute('aria-label');
  });

  // SM-42, ревью владельца 20.08: «нет 1го и 2го числа, только цифры и цифры
  // в скобках». Вторая цифра не должна быть голой «(189)» — она обязана нести
  // подпись, какое это число, иначе человек не отличает кампанию от канала.
  it('вторая цифра видимо подписана как число по каналу, а не голая в скобках', () => {
    render(<ChannelTotal own={100} channel={147} metric="views" attribution={ATTRIBUTION} />);

    const trigger = screen.getByTestId('channel-total');
    expect(trigger.textContent).toContain('147');
    expect(trigger.textContent).toContain('весь канал');
    // Никаких голых скобок с просто числом.
    expect(trigger.textContent).not.toMatch(/^\s*\(\s*\d/);
  });

  it('когда цифры совпадают — второй цифры нет вовсе', () => {
    const { container } = render(<ChannelTotal own={100} channel={100} metric="views" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('нет данных по каналу — молчим, а не показываем ноль', () => {
    const { container } = render(<ChannelTotal own={100} metric="views" />);
    expect(container).toBeEmptyDOMElement();
  });
});
