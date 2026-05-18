import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

interface ElementDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  element?: any;
  onSave: (elementData: any) => void;
}

export default function ElementDialog({ open, onOpenChange, element, onSave }: ElementDialogProps) {
  const [formData, setFormData] = React.useState(element || {});

  React.useEffect(() => {
    setFormData(element || {});
  }, [element]);

  const handleSave = () => {
    onSave(formData);
    onOpenChange(false);
  };

  if (!element) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Редактировать элемент</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          {element.type === 'text' && (
            <>
              <div>
                <Label>Текст</Label>
                <Textarea
                  value={formData.content?.text || ''}
                  onChange={(e) => setFormData({
                    ...formData,
                    content: { ...formData.content, text: e.target.value }
                  })}
                />
              </div>
              <div>
                <Label>Размер шрифта</Label>
                <Input
                  type="number"
                  value={formData.style?.fontSize || 16}
                  onChange={(e) => setFormData({
                    ...formData,
                    style: { ...formData.style, fontSize: parseInt(e.target.value) }
                  })}
                />
              </div>
              <div>
                <Label>Цвет</Label>
                <Input
                  type="color"
                  value={formData.style?.color || '#000000'}
                  onChange={(e) => setFormData({
                    ...formData,
                    style: { ...formData.style, color: e.target.value }
                  })}
                />
              </div>
            </>
          )}
          
          {element.type === 'poll' && (
            <>
              <div>
                <Label>Вопрос</Label>
                <Input
                  value={formData.content?.question || ''}
                  onChange={(e) => setFormData({
                    ...formData,
                    content: { ...formData.content, question: e.target.value }
                  })}
                />
              </div>
              <div>
                <Label>Варианты ответов</Label>
                {(formData.content?.options || ['', '']).map((option: string, index: number) => (
                  <Input
                    key={index}
                    value={option}
                    placeholder={`Вариант ${index + 1}`}
                    onChange={(e) => {
                      const newOptions = [...(formData.content?.options || ['', ''])];
                      newOptions[index] = e.target.value;
                      setFormData({
                        ...formData,
                        content: { ...formData.content, options: newOptions }
                      });
                    }}
                  />
                ))}
              </div>
            </>
          )}
        </div>
        
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button onClick={handleSave}>
            Сохранить
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}