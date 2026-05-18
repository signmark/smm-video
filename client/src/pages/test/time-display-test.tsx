import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import CreationTimeDisplay from '@/components/CreationTimeDisplay';

/**
 * Тестовая страница для проверки отображения времени создания
 */
export default function TimeDisplayTest() {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isFixedDialogOpen, setIsFixedDialogOpen] = useState(false);
  
  // Текущая дата для тестирования
  const currentDate = new Date();
  
  // Дата без смещения часового пояса (старое отображение)
  const oldDisplayDate = new Date(currentDate);
  
  // Дата для тестирования, создаем статичную дату 7 апреля 2025, 10:05
  const testDate = new Date('2025-04-07T10:05:00');
  
  return (
    <div className="container py-10">
      <Card>
        <CardHeader>
          <CardTitle>Тест отображения времени создания</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground">
            Эта страница демонстрирует работу компонента CreationTimeDisplay для корректного отображения времени с учетом часового пояса.
          </p>
          
          <div className="flex flex-col space-y-4">
            <div>
              <Label>Текущая дата и время (обычное отображение):</Label>
              <p>{currentDate.toLocaleString('ru-RU')}</p>
            </div>
            
            <div>
              <Label>Текущая дата и время (компонент CreationTimeDisplay):</Label>
              <CreationTimeDisplay createdAt={currentDate} />
            </div>
            
            <div>
              <Label>Тестовая дата 7 апреля 2025, 10:05 (обычное отображение):</Label>
              <p>{testDate.toLocaleString('ru-RU')}</p>
            </div>
            
            <div>
              <Label>Тестовая дата 7 апреля 2025, 10:05 (с корректировкой часового пояса):</Label>
              <CreationTimeDisplay createdAt={testDate} />
            </div>
          </div>
          
          <div className="flex space-x-4 mt-6">
            <Button onClick={() => setIsDialogOpen(true)}>
              Открыть диалог с текущей датой
            </Button>
            
            <Button onClick={() => setIsFixedDialogOpen(true)}>
              Открыть диалог с фиксированной датой
            </Button>
          </div>
        </CardContent>
      </Card>
      
      {/* Диалог с текущей датой */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Тест времени создания поста</DialogTitle>
          </DialogHeader>
          
          <div className="py-4">
            <div className="flex items-center mb-4">
              <Label htmlFor="contentType" className="mr-2">Текстовый контент</Label>
            </div>
            
            <div className="space-y-4">
              <div>
                <Label>Время верно?</Label>
                <div className="flex items-center mt-2">
                  <CreationTimeDisplay 
                    createdAt={currentDate} 
                    label="Создано:"
                    showIcon={true}
                  />
                </div>
              </div>
            </div>
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              Закрыть
            </Button>
            <Button onClick={() => setIsDialogOpen(false)}>
              Редактировать
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* Диалог с фиксированной датой */}
      <Dialog open={isFixedDialogOpen} onOpenChange={setIsFixedDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Тест времени создания поста</DialogTitle>
          </DialogHeader>
          
          <div className="py-4">
            <div className="flex items-center mb-4">
              <Label htmlFor="contentType" className="mr-2">Текстовый контент</Label>
            </div>
            
            <div className="space-y-4">
              <div>
                <Label>Время верно?</Label>
                <div className="flex items-center mt-2">
                  <CreationTimeDisplay 
                    createdAt={testDate} 
                    label="Создано:"
                    showIcon={true}
                  />
                </div>
              </div>
            </div>
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsFixedDialogOpen(false)}>
              Закрыть
            </Button>
            <Button onClick={() => setIsFixedDialogOpen(false)}>
              Редактировать
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}