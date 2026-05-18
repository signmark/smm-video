import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SimpleRichTextEditor } from '@/components/SimpleRichTextEditor';
import { TextareaWithResize } from '@/components/TextareaWithResize';
import { Button } from '@/components/ui/button';

export default function EditorDemoPage() {
  const initialText1 = 'Это текст в SimpleRichTextEditor. Попробуйте изменить его размер.';
  const initialText2 = 'Это текст в TextareaWithResize. Попробуйте изменить его размер, потянув за правый нижний угол.';
  
  const [text1, setText1] = useState(initialText1);
  const [text2, setText2] = useState(initialText2);
  return (
    <div className="container py-8">
      <h1 className="text-3xl font-bold mb-6">Демо редакторов текста</h1>
      <p className="mb-8 text-muted-foreground">Выберите редактор, который лучше всего подходит для ваших нужд</p>
      
      <Tabs defaultValue="simple">
        <TabsList className="mb-4">
          <TabsTrigger value="simple">Простой редактор</TabsTrigger>
          <TabsTrigger value="textarea">Textarea с ресайзом</TabsTrigger>
        </TabsList>
        
        <TabsContent value="simple">
          <Card>
            <CardHeader>
              <CardTitle>SimpleRichTextEditor</CardTitle>
            </CardHeader>
            <CardContent>
              <SimpleRichTextEditor
                value={text1}
                onChange={setText1}
                minHeight={150}
              />
              <div className="mt-4">
                <h3 className="text-sm font-semibold mb-2">Текущее содержимое:</h3>
                <div className="p-3 border rounded-md bg-muted/30">
                  {text1}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="textarea">
          <Card>
            <CardHeader>
              <CardTitle>TextareaWithResize</CardTitle>
            </CardHeader>
            <CardContent>
              <TextareaWithResize
                value={text2}
                onChange={setText2}
                minHeight={150}
              />
              <div className="mt-4">
                <h3 className="text-sm font-semibold mb-2">Текущее содержимое:</h3>
                <div className="p-3 border rounded-md bg-muted/30">
                  {text2}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
      
      <div className="mt-8">
        <h2 className="text-xl font-bold mb-4">Инструкция по использованию</h2>
        <ul className="list-disc pl-6 space-y-2">
          <li>В обоих компонентах поддерживается изменение размера (resize)</li>
          <li>Для изменения размера потяните за правый нижний угол редактора</li>
          <li>SimpleRichTextEditor имеет простую панель инструментов</li>
          <li>TextareaWithResize - легкий компонент без форматирования</li>
        </ul>
      </div>
    </div>
  );
}