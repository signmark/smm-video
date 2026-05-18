import { useState } from "react";
import { Button } from "@/components/ui/button";
import { TransparentDialog } from "@/components/ui/transparent-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function TransparentDialogTest() {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [secondDialogOpen, setSecondDialogOpen] = useState(false);
  const [formData, setFormData] = useState({
    title: "",
    description: ""
  });

  return (
    <div className="container py-10">
      <Card>
        <CardHeader>
          <CardTitle>Тест прозрачного диалогового окна</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground">
            Эта страница демонстрирует работу компонента TransparentDialog с возможностью
            перетаскивания и изменения размера.
          </p>
          
          <div className="flex space-x-4">
            <Button onClick={() => setIsDialogOpen(true)}>
              Открыть диалог
            </Button>
            
            <Button onClick={() => setSecondDialogOpen(true)}>
              Открыть второй диалог
            </Button>
          </div>
        </CardContent>
      </Card>
      
      {/* Первый диалог */}
      <TransparentDialog
        isOpen={isDialogOpen}
        onClose={() => setIsDialogOpen(false)}
        title="Редактирование записи"
        width={600}
        height={500}
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title">Заголовок</Label>
            <Input 
              id="title"
              value={formData.title}
              onChange={(e) => setFormData({...formData, title: e.target.value})}
              placeholder="Введите заголовок"
            />
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="description">Описание</Label>
            <Textarea 
              id="description"
              value={formData.description}
              onChange={(e) => setFormData({...formData, description: e.target.value})}
              placeholder="Введите описание"
              rows={5}
            />
          </div>
          
          <div className="flex justify-end space-x-2 pt-4">
            <Button 
              variant="outline" 
              onClick={() => setIsDialogOpen(false)}
            >
              Отмена
            </Button>
            <Button onClick={() => {
              console.log("Сохранено:", formData);
              setIsDialogOpen(false);
            }}>
              Сохранить
            </Button>
          </div>
        </div>
      </TransparentDialog>
      
      {/* Второй диалог */}
      <TransparentDialog
        isOpen={secondDialogOpen}
        onClose={() => setSecondDialogOpen(false)}
        title="Информация"
        width={400}
        height={300}
      >
        <div className="space-y-4">
          <p>Это второй диалог, который можно открыть одновременно с первым.</p>
          <p>Оба диалога можно перемещать независимо друг от друга.</p>
          
          <div className="flex justify-end pt-4">
            <Button onClick={() => setSecondDialogOpen(false)}>
              Закрыть
            </Button>
          </div>
        </div>
      </TransparentDialog>
    </div>
  );
}