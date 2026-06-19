const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
const FONT_BOLD = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';
const outPath = path.join(__dirname, '../attached_assets/video-tz.pdf');

const doc = new PDFDocument({ margin: 50, size: 'A4' });
doc.pipe(fs.createWriteStream(outPath));

function h1(text) {
  doc.font(FONT_BOLD).fontSize(17).fillColor('#1a1a2e').text(text, { align: 'center' });
  doc.moveDown(0.4);
}
function h2(text) {
  doc.moveDown(0.5);
  doc.font(FONT_BOLD).fontSize(12).fillColor('#16213e').text(text);
  doc.moveDown(0.15);
}
function h3(text) {
  doc.font(FONT_BOLD).fontSize(10).fillColor('#0f3460').text(text);
}
function body(text) {
  doc.font(FONT).fontSize(9.5).fillColor('#222').text(text, { align: 'justify' });
}
function bullet(items) {
  items.forEach(item => {
    doc.font(FONT).fontSize(9.5).fillColor('#222').text('• ' + item, { indent: 12 });
  });
}
function divider() {
  doc.moveDown(0.2);
  doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#ddd').stroke();
  doc.moveDown(0.3);
}

function tableRow(cols, widths, isHeader = false) {
  const x0 = 50;
  const y0 = doc.y;
  const rowH = 16;
  const totalW = widths.reduce((a, b) => a + b, 0);
  if (isHeader) {
    doc.rect(x0, y0, totalW, rowH).fill('#16213e');
  } else {
    doc.rect(x0, y0, totalW, rowH).fill(doc._tableAlt ? '#f3f4f6' : '#ffffff');
    doc._tableAlt = !doc._tableAlt;
    doc.rect(x0, y0, totalW, rowH).strokeColor('#e5e7eb').stroke();
  }
  let x = x0;
  cols.forEach((col, i) => {
    doc.font(isHeader ? FONT_BOLD : FONT)
      .fontSize(8.5)
      .fillColor(isHeader ? '#ffffff' : '#222')
      .text(col, x + 3, y0 + 4, { width: widths[i] - 6, lineBreak: false });
    x += widths[i];
  });
  doc.y = y0 + rowH;
}

// ── HEADER BLOCK ──
doc.rect(0, 0, 595, 75).fill('#1a1a2e');
doc.font(FONT_BOLD).fontSize(19).fillColor('#ffffff').text('ТЗ: Модуль генерации видео', 50, 18, { align: 'center', width: 495 });
doc.font(FONT).fontSize(10).fillColor('#8892a4').text('SMM Manager Platform  •  Video App', 50, 45, { align: 'center', width: 495 });
doc.y = 90;

// ── 1. ЦЕЛЬ ──
h2('1. Цель');
body('Автоматическая генерация коротких видеороликов из текстовой темы с помощью ИИ для публикации в социальных сетях. Пользователь вводит тему — система самостоятельно пишет сценарий, находит или генерирует визуальный ряд, создаёт озвучку, фоновую музыку и собирает финальный MP4.');
doc.moveDown(0.3);

// ── 2. ВВОД ──
h2('2. Ввод пользователя');
bullet([
  'Тема / описание видео (текст)',
  'Количество сцен',
  'Модель анимации: Wan 2.7 / Kling / Kling Pro / MiniMax / Seedance',
  'Длительность клипа на сцену (5s или 10s, где применимо)',
]);
doc.moveDown(0.3);

// ── 3. ПАЙПЛАЙН ──
h2('3. Пайплайн генерации');

h3('Шаг 1 — Сценарий (AI)');
bullet([
  'Модель: Google Gemini (Vertex AI / Gemini API)',
  'Выход: массив сцен с полями text, imagePrompt, stockQuery',
]);
doc.moveDown(0.2);

h3('Шаг 2 — Stock precheck (фоновый, параллельный)');
bullet([
  'Все сцены одновременно проверяются в Pexels API',
  'Найдено → клип скачивается, videoSource=stock',
  'Не найдено → videoSource=ai, автоматически генерируются 3 варианта картинок',
  'По завершении флаг stockPrechecked=true — UI обновляется без перезагрузки',
]);
doc.moveDown(0.2);

h3('Шаг 3 — Выбор пользователя');
bullet([
  'AI-сцены: выбрать один из 3 вариантов картинки или загрузить свой кадр',
  'Stock-сцены: клип уже готов, выбор не нужен',
  'Возможность переключить тип сцены AI ↔ Stock',
]);
doc.moveDown(0.2);

h3('Шаг 4 — Генерация картинок (AI-сцены)');
bullet([
  'Основная модель: Imagen 4',
  'Фолбэк: Gemini Flash',
  '3 варианта на сцену, пользователь выбирает один',
]);
doc.moveDown(0.2);

h3('Шаг 5 — Анимация (image-to-video) — FAL.AI, все сцены параллельно');
doc.moveDown(0.1);

doc._tableAlt = false;
tableRow(['Модель', 'FAL.AI endpoint', 'Параметры'], [90, 240, 165], true);
[
  ['Wan 2.7', 'fal-ai/wan/v2.7/image-to-video', 'width/height, num_frames: 81'],
  ['Kling', 'fal-ai/kling-video/v1.6/standard/image-to-video', 'duration: 5s / 10s'],
  ['Kling Pro', 'fal-ai/kling-video/v1.6/pro/image-to-video', 'duration: 5s / 10s'],
  ['MiniMax', 'fal-ai/minimax/video-01-live/image-to-video', 'prompt'],
  ['Seedance', 'fal-ai/bytedance/seedance-1-lite/image-to-video', 'duration, aspect_ratio'],
].forEach(r => tableRow(r, [90, 240, 165]));
doc.moveDown(0.3);

h3('Шаг 6 — Озвучка (TTS)');
bullet([
  'Провайдер 1 (основной): OpenAI TTS — модель tts-1, голос shimmer',
  'Провайдер 2 (фолбэк при 429): HuggingFace facebook/mms-tts-rus → WAV → конвертация в MP3',
  'Каждая сцена — отдельный MP3-файл',
]);
doc.moveDown(0.2);

h3('Шаг 7 — Фоновая музыка');
bullet([
  'Сервис: HuggingFace MusicGen (facebook/musicgen-small)',
  'Промпт строится автоматически по теме видео',
  'Громкость: 18% (голос преобладает)',
  'При ошибке — тихий фолбэк, видео остаётся без музыки',
]);
doc.moveDown(0.2);

h3('Шаг 8 — Финальная сборка');
bullet([
  'Инструмент: ffmpeg',
  'Склейка видеоклипов всех сцен в один MP4',
  'Наложение аудиодорожки TTS + подмешивание фоновой музыки',
  'Результат: один MP4-файл, доступный для скачивания',
]);
doc.moveDown(0.4);

// ── 4. ХРАНЕНИЕ ──
divider();
h2('4. Хранение данных');
bullet([
  'БД: PostgreSQL, таблица video_projects (автосоздаётся при старте)',
  'Файлы: video-app/data/images/ (кадры), video-app/data/videos/ (клипы и результат)',
  'Фолбэк без DATABASE_URL: JSON-файл на диске',
]);
doc.moveDown(0.3);

// ── 5. ТЕХНИЧЕСКИЕ ТРЕБОВАНИЯ ──
h2('5. Технические требования');
bullet([
  'Порт: 3001 (отдельный Express-сервер)',
  'Фронтенд: React + Vite (base: /video-app/)',
  'Прокси: основное приложение (порт 5000) форвардит /video-app/* → 3001',
  'Зависимости API: FAL_AI_API_KEY, OPENAI_API_KEY, HUGGINGFACE_API_KEY, PEXELS_API_KEY, Gemini/Vertex AI',
]);
doc.moveDown(0.3);

// ── 6. API — new page ──
doc.addPage();
h2('6. API эндпоинты');

doc._tableAlt = false;
tableRow(['Метод', 'Путь', 'Описание'], [60, 240, 195], true);
[
  ['GET',    '/api/videos',                                  'Список проектов'],
  ['POST',   '/api/videos',                                  'Создать проект'],
  ['GET',    '/api/videos/:id',                              'Получить проект со сценами'],
  ['DELETE', '/api/videos/:id',                              'Удалить проект'],
  ['POST',   '/api/videos/:id/generate',                     'Запустить генерацию'],
  ['GET',    '/api/videos/:id/download',                     'Скачать итоговый MP4'],
  ['GET',    '/api/videos/:id/audio/:sceneIndex',            'TTS-превью сцены'],
  ['GET',    '/api/videos/:id/images/:sceneIndex/:variant',  'Картинка варианта (0–2, 3=custom)'],
  ['GET',    '/api/videos/:id/clips/:sceneIndex',            'Стоковый клип сцены (MP4)'],
  ['POST',   '/api/videos/:id/scenes/:i/generate-variants',  'Сгенерировать 3 варианта картинок'],
  ['POST',   '/api/videos/:id/scenes/:i/stock-retry',        'Повторный поиск стока для сцены'],
  ['PATCH',  '/api/videos/:id/scenes/:sceneId',              'Обновить поля сцены'],
  ['POST',   '/api/videos/:id/scenes/:i/upload-frame',       'Загрузить свой кадр (вариант 3)'],
].forEach(r => tableRow(r, [60, 240, 195]));

doc.moveDown(0.8);
divider();
doc.font(FONT).fontSize(9).fillColor('#888')
  .text(`SMM Manager — Video App ТЗ  •  ${new Date().toLocaleDateString('ru-RU')}`, { align: 'center' });

doc.end();
doc.on('finish', () => console.log('PDF ready:', outPath));
