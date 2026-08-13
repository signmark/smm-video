/**
 * SM-26: генерация по образцу должна быть заметной и принимать несколько ссылок.
 *
 * Жалоба была не «не работает», а «не видно, что оно есть»: поле образца
 * появлялось только под уже выбранной моделью edit, а по умолчанию выбрана
 * другая. Поэтому проверяем две вещи: подсказка стоит на месте поля при
 * неподдерживающей модели и исчезает при поддерживающей; и что несколько
 * приложенных ссылок доходят до тела запроса СПИСКОМ, а не первой.
 */
import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReferenceImagesField } from '@/components/ReferenceImagesField';
import {
  MAX_REFERENCE_IMAGES,
  REFERENCE_MODEL_ID,
  REFERENCE_MODEL_LABEL,
  isReferenceMissing,
  referencePayload,
  supportsReference,
} from '@/components/image-generation/reference-models';

const A = 'https://example.test/a.png';
const B = 'https://example.test/b.png';

function Harness({ modelId, initial = [] }: { modelId: string; initial?: string[] }) {
  const [urls, setUrls] = useState<string[]>(initial);
  return (
    <>
      <div data-testid="итого">{urls.join('|')}</div>
      <ReferenceImagesField modelId={modelId} urls={urls} onChange={setUrls} />
    </>
  );
}

describe('SM-26: видимость генерации по образцу', () => {
  it('при модели без поддержки на месте поля стоит подсказка, а не пустота', () => {
    render(<Harness modelId="gemini" />);
    const hint = screen.getByTestId('reference-hint');
    expect(hint.textContent).toContain(REFERENCE_MODEL_LABEL);
    // Подсказка именно подсказывает: ни поля, ни запрета.
    expect(screen.queryByTestId('reference-url-input')).toBeNull();
  });

  it('при поддерживающей модели подсказка уходит и появляется поле', () => {
    render(<Harness modelId={REFERENCE_MODEL_ID} />);
    expect(screen.queryByTestId('reference-hint')).toBeNull();
    expect(screen.getByTestId('reference-url-input')).toBeInTheDocument();
    expect(screen.getByTestId('reference-counter').textContent).toBe(`0 из ${MAX_REFERENCE_IMAGES}`);
  });

  it('название модели читается как возможность, а не как код', () => {
    expect(REFERENCE_MODEL_LABEL).toMatch(/по образцу/i);
    expect(REFERENCE_MODEL_LABEL).not.toMatch(/edit/i);
  });
});

describe('SM-26: несколько образцов', () => {
  const addUrl = (value: string) => {
    fireEvent.change(screen.getByTestId('reference-url-input'), { target: { value } });
    fireEvent.click(screen.getByTestId('reference-add'));
  };

  it('прикладываются несколько ссылок, каждую видно и каждую можно убрать', () => {
    render(<Harness modelId={REFERENCE_MODEL_ID} />);
    addUrl(A);
    addUrl(B);

    expect(screen.getByTestId('итого').textContent).toBe(`${A}|${B}`);
    expect(screen.getByTestId('reference-item-0')).toBeInTheDocument();
    expect(screen.getByTestId('reference-item-1')).toBeInTheDocument();
    expect(screen.getByTestId('reference-counter').textContent).toBe(`2 из ${MAX_REFERENCE_IMAGES}`);

    fireEvent.click(screen.getByTestId('reference-remove-0'));
    expect(screen.getByTestId('итого').textContent).toBe(B);
  });

  it('один и тот же образец дважды не занимает предел', () => {
    render(<Harness modelId={REFERENCE_MODEL_ID} />);
    addUrl(A);
    addUrl(A);
    expect(screen.getByTestId('итого').textContent).toBe(A);
  });

  it('предел равен трём, и это не украшение, а размер тела запроса', () => {
    // Загруженный файл уходит в тело как base64 (+37% к размеру), тело сервер
    // принимает до 50 МБ, своего ограничения на размер одной картинки нет.
    // Четыре снимка по 9 МБ — это уже ~49 МБ до промта и прочих полей, то есть
    // отказ сервера без объяснения. Поднимать предел можно только вместе с
    // ограничением размера картинки.
    expect(MAX_REFERENCE_IMAGES).toBe(3);
  });

  it('предел объявлен на экране и дальше него не пускает', () => {
    const full = Array.from({ length: MAX_REFERENCE_IMAGES }, (_, i) => `https://example.test/${i}.png`);
    render(<Harness modelId={REFERENCE_MODEL_ID} initial={full} />);

    expect(screen.getByTestId('reference-counter').textContent)
      .toBe(`${MAX_REFERENCE_IMAGES} из ${MAX_REFERENCE_IMAGES}`);
    expect(screen.getByTestId('reference-limit')).toBeInTheDocument();
    expect(screen.getByTestId('reference-url-input')).toBeDisabled();
    expect(screen.getByTestId('reference-add')).toBeDisabled();
  });
});

describe('SM-26: что уходит в запрос', () => {
  it('все приложенные образцы уходят списком, а не первый', () => {
    expect(referencePayload(REFERENCE_MODEL_ID, [A, B])).toEqual({ imageUrls: [A, B] });
  });

  it('пустые и пробельные ссылки в тело не попадают', () => {
    expect(referencePayload(REFERENCE_MODEL_ID, ['  ', '', ` ${A} `])).toEqual({ imageUrls: [A] });
  });

  it('без образцов и для чужой модели ничего не добавляется', () => {
    expect(referencePayload(REFERENCE_MODEL_ID, [])).toEqual({});
    expect(referencePayload('gemini', [A, B])).toEqual({});
    expect(supportsReference('gemini')).toBe(false);
    expect(supportsReference(REFERENCE_MODEL_ID)).toBe(true);
  });

  it('сверх предела в тело не уходит даже при подсунутом длинном списке', () => {
    const many = Array.from({ length: MAX_REFERENCE_IMAGES + 3 }, (_, i) => `https://example.test/${i}.png`);
    expect(referencePayload(REFERENCE_MODEL_ID, many).imageUrls).toHaveLength(MAX_REFERENCE_IMAGES);
  });
});

describe('SM-26: правило «без образца не генерируем» сохранено', () => {
  // Условие вычисляет тот же самый `isReferenceMissing`, которым диалог гасит
  // кнопку и показывает предупреждение, — поэтому потерять правило при правке
  // поля нельзя незаметно.
  it('для модели с образцом без единого образца генерация запрещена', () => {
    expect(isReferenceMissing(REFERENCE_MODEL_ID, [])).toBe(true);
    expect(isReferenceMissing(REFERENCE_MODEL_ID, [A])).toBe(false);
  });

  it('для остальных моделей правило не действует', () => {
    expect(isReferenceMissing('gemini', [])).toBe(false);
  });
});
