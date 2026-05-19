#!/bin/bash

# Конвертер видео для Instagram Stories с H.264 Main профилем
# Использует протестированные рабочие параметры

if [ $# -eq 0 ]; then
    echo "🎬 Конвертер для Instagram Stories (H.264 Main профиль)"
    echo ""
    echo "Использование: ./convert-to-instagram-main.sh <input.mp4> [output.mp4]"
    echo ""
    echo "Примеры:"
    echo "  ./convert-to-instagram-main.sh video.mp4"
    echo "  ./convert-to-instagram-main.sh video.mp4 instagram_ready.mp4"
    echo ""
    echo "Параметры конвертации:"
    echo "  - H.264 Main профиль (протестировано для Instagram)"
    echo "  - 1080x1920 разрешение"
    echo "  - 30 FPS"
    echo "  - 3 Mbps битрейт"
    echo "  - AAC аудио 128k"
    exit 1
fi

INPUT_FILE="$1"
OUTPUT_FILE="${2:-instagram_main_$(basename "$INPUT_FILE")}"

if [ ! -f "$INPUT_FILE" ]; then
    echo "❌ Файл не найден: $INPUT_FILE"
    exit 1
fi

echo "🔧 КОНВЕРТИРУЮ ДЛЯ INSTAGRAM STORIES..."
echo "Входной файл: $INPUT_FILE"
echo "Выходной файл: $OUTPUT_FILE"
echo ""

# Рабочие параметры H.264 Main профиль
ffmpeg -i "$INPUT_FILE" \
  -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black,fps=30" \
  -c:v libx264 \
  -profile:v main \
  -level 4.0 \
  -pix_fmt yuv420p \
  -b:v 3M \
  -maxrate 4M \
  -bufsize 8M \
  -c:a aac \
  -ar 44100 \
  -ac 2 \
  -b:a 128k \
  -movflags +faststart \
  -f mp4 \
  -y "$OUTPUT_FILE"

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ КОНВЕРТАЦИЯ ЗАВЕРШЕНА!"
    echo "📁 Файл: $OUTPUT_FILE"
    echo ""
    echo "=== ПАРАМЕТРЫ ВИДЕО ==="
    ffprobe -hide_banner -show_streams -show_format "$OUTPUT_FILE" 2>/dev/null | grep -E "(profile|level|codec_name|pix_fmt|width|height|r_frame_rate)" | head -10
    echo ""
    echo "🚀 Готово к загрузке в Instagram Stories!"
else
    echo "❌ Ошибка конвертации"
    exit 1
fi