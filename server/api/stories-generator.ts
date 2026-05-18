import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs/promises';
import { Request, Response } from 'express';

const execAsync = promisify(exec);

/**
 * Генерирует статические превью для Stories
 * @param storyData Данные Stories со слайдами
 * @returns Массив ссылок на сгенерированные изображения
 */
export async function generateStoryPreviews(storyData: any): Promise<string[]> {
  try {
    // Создаем временный файл с данными Stories
    const tempDir = path.join(process.cwd(), 'temp');
    await fs.mkdir(tempDir, { recursive: true });
    
    const storyDataPath = path.join(tempDir, `story_${Date.now()}.json`);
    const outputDir = path.join(tempDir, `story_output_${Date.now()}`);
    
    // Записываем данные Stories
    await fs.writeFile(storyDataPath, JSON.stringify(storyData, null, 2));
    
    // Запускаем Python скрипт для генерации
    const pythonScript = path.join(process.cwd(), 'server/api/generate-story-preview.py');
    const command = `python3 "${pythonScript}" "${storyDataPath}" "${outputDir}"`;
    
    const { stdout, stderr } = await execAsync(command);
    
    if (stderr) {
      console.error('Python stderr:', stderr);
    }
    
    // Парсим результат
    const lastLine = stdout.trim().split('\n').pop();
    const result = JSON.parse(lastLine || '{"generated_files": []}');
    
    // Копируем файлы в публичную директорию
    const publicDir = path.join(process.cwd(), 'uploads/stories');
    await fs.mkdir(publicDir, { recursive: true });
    
    const publicUrls: string[] = [];
    
    for (const filePath of result.generated_files) {
      const fileName = path.basename(filePath);
      const publicPath = path.join(publicDir, fileName);
      
      await fs.copyFile(filePath, publicPath);
      publicUrls.push(`/uploads/stories/${fileName}`);
    }
    
    // Очищаем временные файлы
    await fs.unlink(storyDataPath);
    await fs.rm(outputDir, { recursive: true, force: true });
    
    return publicUrls;
    
  } catch (error) {
    console.error('Ошибка генерации превью Stories:', error);
    throw new Error('Не удалось сгенерировать превью Stories');
  }
}

/**
 * API endpoint для генерации превью Stories
 */
export async function handleGenerateStoryPreviews(req: Request, res: Response) {
  try {
    const { storyData } = req.body;
    
    if (!storyData || !storyData.slides) {
      return res.status(400).json({
        success: false,
        error: 'Некорректные данные Stories'
      });
    }
    
    const previewUrls = await generateStoryPreviews(storyData);
    
    res.json({
      success: true,
      previews: previewUrls
    });
    
  } catch (error) {
    console.error('Ошибка API генерации Stories:', error);
    res.status(500).json({
      success: false,
      error: 'Внутренняя ошибка сервера'
    });
  }
}