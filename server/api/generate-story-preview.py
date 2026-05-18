#!/usr/bin/env python3
"""
Генератор статических превью для Stories
Создает изображения слайдов Stories для предпросмотра и публикации
"""

import json
import sys
import os
from PIL import Image, ImageDraw, ImageFont
import requests
from io import BytesIO
import uuid

def generate_story_slide(slide_data, output_path):
    """Генерирует статическое изображение слайда Stories"""
    
    # Размер Stories (9:16)
    width, height = 1080, 1920
    
    # Создаем базовое изображение
    if slide_data['background']['type'] == 'color':
        img = Image.new('RGB', (width, height), slide_data['background']['value'])
    elif slide_data['background']['type'] == 'image':
        try:
            bg_response = requests.get(slide_data['background']['value'])
            bg_img = Image.open(BytesIO(bg_response.content))
            img = bg_img.resize((width, height), Image.Resampling.LANCZOS)
        except Exception as e:
            print(f"Ошибка загрузки фона: {e}")
            img = Image.new('RGB', (width, height), '#000000')
    else:
        img = Image.new('RGB', (width, height), '#000000')
    
    draw = ImageDraw.Draw(img)
    
    # Обрабатываем элементы слайда
    for element in slide_data.get('elements', []):
        try:
            if element['type'] == 'text':
                add_text_element(draw, element, width, height)
            elif element['type'] in ['image', 'ai-image']:
                add_image_element(img, element, width, height)
            elif element['type'] == 'poll':
                add_poll_element(draw, element, width, height)
            elif element['type'] == 'quiz':
                add_quiz_element(draw, element, width, height)
        except Exception as e:
            print(f"Ошибка обработки элемента {element['type']}: {e}")
    
    # Сохраняем изображение
    img.save(output_path, 'PNG', quality=95)
    return output_path

def add_text_element(draw, element, img_width, img_height):
    """Добавляет текстовый элемент"""
    content = element['content']
    position = element['position']
    
    try:
        font_size = int(content.get('fontSize', 24))
        font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', font_size)
    except:
        font = ImageFont.load_default()
    
    text = content.get('text', '')
    color = content.get('color', '#ffffff')
    
    # Позиционируем текст
    x = int(position['x'] * img_width / 100)
    y = int(position['y'] * img_height / 100)
    
    # Добавляем тень для лучшей читаемости
    draw.text((x+2, y+2), text, font=font, fill='#000000')
    draw.text((x, y), text, font=font, fill=color)

def add_image_element(img, element, img_width, img_height):
    """Добавляет изображение"""
    content = element['content']
    position = element['position']
    
    try:
        response = requests.get(content['url'])
        element_img = Image.open(BytesIO(response.content))
        
        # Размер элемента (максимум 300px по ширине)
        max_width = 300
        ratio = min(max_width / element_img.width, max_width / element_img.height)
        new_size = (int(element_img.width * ratio), int(element_img.height * ratio))
        element_img = element_img.resize(new_size, Image.Resampling.LANCZOS)
        
        # Позиционируем изображение
        x = int(position['x'] * img_width / 100)
        y = int(position['y'] * img_height / 100)
        
        # Вставляем изображение
        img.paste(element_img, (x, y), element_img if element_img.mode == 'RGBA' else None)
        
    except Exception as e:
        print(f"Ошибка добавления изображения: {e}")

def add_poll_element(draw, element, img_width, img_height):
    """Добавляет элемент опроса"""
    content = element['content']
    position = element['position']
    
    # Позиция опроса
    x = int(position['x'] * img_width / 100)
    y = int(position['y'] * img_height / 100)
    
    try:
        font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 24)
        small_font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 18)
    except:
        font = ImageFont.load_default()
        small_font = ImageFont.load_default()
    
    # Фон опроса
    poll_width = 300
    poll_height = 50 + len(content.get('options', [])) * 40
    draw.rectangle([x, y, x + poll_width, y + poll_height], fill='rgba(255,255,255,0.9)', outline='#cccccc')
    
    # Вопрос
    draw.text((x + 10, y + 10), content.get('question', ''), font=font, fill='#000000')
    
    # Варианты ответов
    for i, option in enumerate(content.get('options', [])):
        option_y = y + 50 + i * 40
        draw.rectangle([x + 10, option_y, x + poll_width - 10, option_y + 30], fill='#f0f0f0', outline='#cccccc')
        draw.text((x + 20, option_y + 5), option, font=small_font, fill='#333333')

def add_quiz_element(draw, element, img_width, img_height):
    """Добавляет элемент викторины"""
    content = element['content']
    position = element['position']
    
    # Аналогично опросу, но с выделением правильного ответа
    x = int(position['x'] * img_width / 100)
    y = int(position['y'] * img_height / 100)
    
    try:
        font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 24)
        small_font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 18)
    except:
        font = ImageFont.load_default()
        small_font = ImageFont.load_default()
    
    quiz_width = 300
    quiz_height = 50 + len(content.get('options', [])) * 40
    draw.rectangle([x, y, x + quiz_width, y + quiz_height], fill='rgba(255,255,255,0.9)', outline='#cccccc')
    
    # Вопрос викторины
    draw.text((x + 10, y + 10), content.get('question', ''), font=font, fill='#000000')
    
    # Варианты ответов
    correct_answer = content.get('correctAnswer', 0)
    for i, option in enumerate(content.get('options', [])):
        option_y = y + 50 + i * 40
        bg_color = '#d4edda' if i == correct_answer else '#f0f0f0'
        draw.rectangle([x + 10, option_y, x + quiz_width - 10, option_y + 30], fill=bg_color, outline='#cccccc')
        draw.text((x + 20, option_y + 5), option, font=small_font, fill='#333333')
        if i == correct_answer:
            draw.text((x + quiz_width - 30, option_y + 5), '✓', font=small_font, fill='#28a745')

def main():
    if len(sys.argv) != 3:
        print("Использование: python generate-story-preview.py <story_data.json> <output_dir>")
        sys.exit(1)
    
    story_data_path = sys.argv[1]
    output_dir = sys.argv[2]
    
    # Читаем данные Stories
    with open(story_data_path, 'r', encoding='utf-8') as f:
        story_data = json.load(f)
    
    # Создаем директорию для вывода
    os.makedirs(output_dir, exist_ok=True)
    
    generated_files = []
    
    # Генерируем превью для каждого слайда
    for i, slide in enumerate(story_data.get('slides', [])):
        output_path = os.path.join(output_dir, f'slide_{i+1}_{uuid.uuid4().hex[:8]}.png')
        generated_path = generate_story_slide(slide, output_path)
        generated_files.append(generated_path)
        print(f"Сгенерирован слайд {i+1}: {generated_path}")
    
    # Возвращаем список созданных файлов
    print(json.dumps({"generated_files": generated_files}))

if __name__ == "__main__":
    main()