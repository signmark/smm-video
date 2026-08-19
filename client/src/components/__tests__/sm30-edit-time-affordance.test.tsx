/**
 * SM-30: изменение времени запланированной публикации должно быть заметно.
 *
 * Возможность была и раньше: карандаш справа открывает редактирование вместе с
 * полями даты и времени. Но карандаш — иконка без подписи, а дата и время
 * слева выглядели обычным текстом, и тестировщик не нашёл способ вовсе. Отсюда
 * проверка не «есть ли код», а «видно ли это глазом»: блок с датой сам стал
 * кнопкой, у него есть имя для читалки экрана и подпись, видимая без наведения.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/lib/queryClient', () => ({ apiRequest: vi.fn() }));
vi.mock('@/components/EditScheduledPublication', () => ({
  default: () => <div data-testid="форма-редактирования">форма</div>,
}));

import ScheduledPublicationDetails from '@/components/ScheduledPublicationDetails';

const CONTENT: any = {
  id: 'c-1',
  title: 'Пост про осень',
  content: '<p>Текст поста</p>',
  scheduledAt: '2026-08-25T09:30:00.000Z',
  socialPlatforms: {
    telegram: { status: 'scheduled', publishedAt: '2026-08-25T09:30:00.000Z' },
  },
};

const card = () => render(<ScheduledPublicationDetails content={CONTENT} />);

describe('SM-30: время публикации видно, что редактируемо', () => {
  it('блок с датой и временем — кнопка, а не текст', () => {
    card();
    expect(screen.getByTestId('btn-edit-time-c-1').tagName).toBe('BUTTON');
  });

  it('у кнопки есть имя, по которому понятно, что она меняет', () => {
    card();
    expect(screen.getByTestId('btn-edit-time-c-1')).toHaveAttribute(
      'aria-label',
      expect.stringContaining('время'),
    );
  });

  it('подпись «изменить» видна сразу, без наведения', () => {
    card();
    expect(screen.getByTestId('hint-edit-time-c-1').textContent).toContain('изменить');
  });

  it('нажатие на дату открывает редактирование', async () => {
    card();
    expect(screen.queryByTestId('форма-редактирования')).toBeNull();

    await userEvent.click(screen.getByTestId('btn-edit-time-c-1'));
    expect(await screen.findByTestId('форма-редактирования')).toBeTruthy();
  });

  it('карандаш справа продолжает открывать то же редактирование', async () => {
    card();
    await userEvent.click(screen.getByTestId('btn-edit-c-1'));
    expect(await screen.findByTestId('форма-редактирования')).toBeTruthy();
  });

  it('время на карточке по-прежнему показано', () => {
    card();
    // 09:30 UTC — 12:30 по Москве; проверяем сам факт вывода времени, а не пояс.
    expect(screen.getByTestId('btn-edit-time-c-1').textContent).toMatch(/\d{2}:\d{2}/);
  });
});
