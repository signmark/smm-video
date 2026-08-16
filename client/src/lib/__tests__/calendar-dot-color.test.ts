/**
 * AI-116: цвет маркера считается по содержимому материала, а не по метке типа.
 *
 * Красный-до: цвет брался из `contentType`. На боевых данных метка расходилась
 * с содержимым примерно у каждого третьего материала (замер 16.08 на 1868
 * записях), и пост с картинкой светился синим — «текстовым». Все проверки
 * «метка врёт» ниже до правки были красными.
 *
 * Формы записей здесь взяты с боевых: метка `text` при заполненной картинке,
 * метка `text-image` при пустой картинке, метка `video` без видео, и медиа,
 * лежащее только в `additionalMedia` (сторис и клипы хранят файл там).
 */
import { describe, it, expect } from 'vitest';
import {
  detectMediaKind,
  dotColorForContent,
  dotColorForMediaKind,
  FAILED_PUBLICATION_DOT_COLOR,
  MEDIA_KIND_DOT_COLOR,
} from '../calendar-dot-color';

describe('AI-116: род содержимого определяется по фактическим медиа', () => {
  it('видео важнее картинки: есть и то и другое — это видео', () => {
    expect(detectMediaKind({ imageUrl: 'https://x/i.jpg', videoUrl: 'https://x/v.mp4' })).toBe('video');
  });

  it('только картинка — это картинка', () => {
    expect(detectMediaKind({ imageUrl: 'https://x/i.jpg' })).toBe('image');
  });

  it('без медиа — это текст', () => {
    expect(detectMediaKind({})).toBe('text');
  });

  it('пустая строка и пробелы медиа не считаются', () => {
    expect(detectMediaKind({ imageUrl: '', videoUrl: '   ' })).toBe('text');
  });

  it('материала нет вовсе — это текст, а не падение', () => {
    expect(detectMediaKind(null)).toBe('text');
    expect(detectMediaKind(undefined)).toBe('text');
  });

  it('медиа только в additionalMedia тоже считается', () => {
    expect(detectMediaKind({
      additionalMedia: [{ url: 'https://x/s.mp4', type: 'generated_video' }],
    })).toBe('video');
    expect(detectMediaKind({
      additionalMedia: [{ url: 'https://x/s.jpg', type: 'generated_image' }],
    })).toBe('image');
  });

  it('элемент additionalMedia без ссылки не считается медиа', () => {
    expect(detectMediaKind({ additionalMedia: [{ url: '', type: 'generated_image' }] })).toBe('text');
  });

  it('устаревшие списки additionalImages/additionalVideos тоже учитываются', () => {
    expect(detectMediaKind({ additionalImages: ['https://x/i.jpg'] })).toBe('image');
    expect(detectMediaKind({ additionalVideos: ['https://x/v.mp4'] })).toBe('video');
  });
});

describe('AI-116: метка типа на цвет не влияет — именно она и врала', () => {
  it('метка «текст» при заполненной картинке даёт жёлтый, а не синий', () => {
    // 58 таких записей в боевой базе на 16.08.
    const content: any = { contentType: 'text', imageUrl: 'https://x/i.jpg' };
    expect(dotColorForContent(content)).toBe(MEDIA_KIND_DOT_COLOR.image);
  });

  it('метка «текст с картинкой» без картинки даёт синий, а не жёлтый', () => {
    // 258 таких записей.
    const content: any = { contentType: 'text-image' };
    expect(dotColorForContent(content)).toBe(MEDIA_KIND_DOT_COLOR.text);
  });

  it('метка «текст с картинкой» при видео внутри даёт красный', () => {
    // 137 таких записей.
    const content: any = { contentType: 'text-image', videoUrl: 'https://x/v.mp4' };
    expect(dotColorForContent(content)).toBe(MEDIA_KIND_DOT_COLOR.video);
  });

  it('метка «видео» без видео даёт синий, а не красный', () => {
    // 46 таких записей. Проверено отдельно: additionalMedia у них пуст.
    const content: any = { contentType: 'video' };
    expect(dotColorForContent(content)).toBe(MEDIA_KIND_DOT_COLOR.text);
  });
});

describe('AI-116: таблица цветов — одна на все календари', () => {
  it('каждому роду содержимого соответствует свой класс', () => {
    // Видео — фиолетовое, а НЕ красное: красный отдан ошибке (решение
    // владельца от 16.08). Если кто-то вернёт видео в красный, покраснеет
    // и эта проверка, и «красный не занят содержимым» ниже.
    expect(dotColorForMediaKind('video')).toBe('bg-violet-500');
    expect(dotColorForMediaKind('image')).toBe('bg-yellow-500');
    expect(dotColorForMediaKind('text')).toBe('bg-blue-500');
  });

  it('красный не занят ни одним родом содержимого — он принадлежит ошибке', () => {
    expect(Object.values(MEDIA_KIND_DOT_COLOR)).not.toContain(FAILED_PUBLICATION_DOT_COLOR);
  });

  it('цвета не повторяются: иначе два рода содержимого неразличимы', () => {
    const values = Object.values(MEDIA_KIND_DOT_COLOR);
    expect(new Set(values).size).toBe(values.length);
  });
});
