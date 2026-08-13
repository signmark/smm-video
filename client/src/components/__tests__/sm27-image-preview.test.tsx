/**
 * SM-27: крупный просмотр сгенерированной картинки.
 *
 * Главное, что здесь проверяется, — просмотр не ворует выбор. Именно это ломается
 * первым, если открывать модалку кликом по превью: человек хотел посмотреть, а
 * заодно переключил выбранную картинку и не заметил.
 *
 * Выбор живёт в родителе (как и в ImageGenerationDialog), поэтому тест держит
 * его сам и смотрит на реальный контракт: onSelect дёрнут или нет.
 */
import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { GeneratedImagesPreview } from '@/components/GeneratedImagesPreview';

const IMAGES = ['https://example.test/a.png', 'https://example.test/b.png'];

function Harness({ onSelect }: { onSelect?: (index: number) => void }) {
  const [selected, setSelected] = useState(1);
  return (
    <>
      <div data-testid="выбрано">{selected}</div>
      <GeneratedImagesPreview
        images={IMAGES}
        selectedIndex={selected}
        onSelect={(index) => {
          onSelect?.(index);
          setSelected(index);
        }}
      />
    </>
  );
}

describe('SM-27: крупный просмотр сгенерированной картинки', () => {
  it('лупа открывает картинку крупно', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByLabelText('Открыть изображение 1 крупно'));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    expect(screen.getByText('Изображение 1 из 2')).toBeInTheDocument();
  });

  it('Esc закрывает просмотр', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByLabelText('Открыть изображение 1 крупно'));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('после просмотра и закрытия выбор остался прежним', async () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    expect(screen.getByTestId('выбрано').textContent).toBe('1');

    // Смотрим ПЕРВУЮ картинку, выбрана при этом вторая.
    fireEvent.click(screen.getByLabelText('Открыть изображение 1 крупно'));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByTestId('выбрано').textContent).toBe('1');
  });

  it('клик по самому превью по-прежнему выбирает картинку', () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    fireEvent.click(screen.getByAltText('Изображение 1'));
    expect(onSelect).toHaveBeenCalledWith(0);
    expect(screen.getByTestId('выбрано').textContent).toBe('0');
  });
});
