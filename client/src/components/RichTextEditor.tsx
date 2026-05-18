import { useEffect, useRef, useState } from 'react';
import { Editor, EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import TextStyle from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Italic,
  Link as LinkIcon,
  Image as ImageIcon,
  Strikethrough,
  Code,
  Quote,
  EyeOff
} from 'lucide-react';
import { Smile } from 'lucide-react';
import { Check, ChevronRight, Wand2 } from 'lucide-react';
import { UnderlineIcon } from 'lucide-react';
import { 
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider
} from '@/components/ui/tooltip';
import {
  ToggleGroup,
  ToggleGroupItem,
} from '@/components/ui/toggle-group';
import { Label } from '@/components/ui/label';
import { EmojiPicker } from './EmojiPicker';
import { TextEnhancementDialog } from './TextEnhancementDialog';

// CSS стили с поддержкой темной темы
const editorStyles = `
  .resizable-editor {
    resize: both;
    overflow: hidden;
    min-height: 400px;
    border: 1px solid hsl(var(--border));
    border-radius: 0.375rem;
    position: relative;
    background-color: hsl(var(--background));
  }
  
  .resizable-editor .ProseMirror {
    min-height: 300px;
    height: 100%;
    outline: none;
    color: hsl(var(--foreground));
    background-color: hsl(var(--background));
    padding: 1rem;
  }
  
  .resizable-editor .ProseMirror p.is-editor-empty:first-child::before {
    color: hsl(var(--muted-foreground));
    content: attr(data-placeholder);
    float: left;
    height: 0;
    pointer-events: none;
  }
  
  .resizable-editor .ProseMirror h1,
  .resizable-editor .ProseMirror h2,
  .resizable-editor .ProseMirror h3 {
    color: hsl(var(--foreground));
  }
  
  .resizable-editor .ProseMirror blockquote {
    border-left: 4px solid hsl(var(--border));
    padding-left: 1rem;
    margin-left: 0;
    color: hsl(var(--muted-foreground));
  }
  
  .resizable-editor .ProseMirror code {
    background-color: hsl(var(--muted));
    color: hsl(var(--foreground));
    padding: 0.2rem 0.4rem;
    border-radius: 0.25rem;
    font-size: 0.875em;
  }
  
  .resizable-editor .ProseMirror pre {
    background-color: hsl(var(--muted));
    color: hsl(var(--foreground));
    padding: 1rem;
    border-radius: 0.375rem;
    overflow-x: auto;
  }
  
  .resizable-editor .ProseMirror pre code {
    background: none;
    padding: 0;
  }
  
  .resizable-editor .ProseMirror a {
    color: hsl(var(--primary));
    text-decoration: underline;
  }
  
  .resizable-editor .ProseMirror a:hover {
    color: hsl(var(--primary));
    opacity: 0.8;
  }
  
  .resizable-editor .ProseMirror img {
    max-width: 100%;
    height: auto;
    border-radius: 0.375rem;
  }
  
  .resizable-editor .ProseMirror tg-spoiler {
    background-color: hsl(var(--muted-foreground));
    color: transparent;
    padding: 0.1rem 0.2rem;
    border-radius: 0.25rem;
    cursor: pointer;
    transition: all 0.2s;
  }
  
  .resizable-editor .ProseMirror tg-spoiler:hover {
    background-color: transparent;
    color: hsl(var(--foreground));
  }
  
  .resizable-editor .editor-content {
    height: calc(100% - 50px);
    overflow: auto;
  }
  
  .resize-handle {
    position: absolute;
    right: 0;
    bottom: 0;
    width: 12px;
    height: 12px;
    cursor: se-resize;
    opacity: 0.5;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='hsl(var(--muted-foreground))' viewBox='0 0 24 24'%3E%3Cpath d='M22 22H20V20H22V22ZM22 18H18V16H20V14H22V18ZM16 22H14V20H16V22ZM18 12H20V14H18V12ZM12 22H10V20H12V22ZM8 22H6V20H8V22Z'/%3E%3C/svg%3E");
    background-position: bottom right;
    background-repeat: no-repeat;
  }
  
  .resize-handle:hover {
    opacity: 1;
  }
`;

interface RichTextEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  minHeight?: number;
  className?: string;
  enableResize?: boolean;
}

export default function RichTextEditor({
  value,
  onChange,
  placeholder = 'Начните вводить текст...',
  minHeight = 150,
  className,
  enableResize = true,
}: RichTextEditorProps) {
  const [selectedColor, setSelectedColor] = useState<string>('#000000');
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const [isTextEnhancementOpen, setIsTextEnhancementOpen] = useState(false);
  const editorContainerRef = useRef<HTMLDivElement>(null);

  // Добавляем стили в DOM при монтировании компонента
  useEffect(() => {
    const styleElement = document.createElement('style');
    styleElement.textContent = editorStyles;
    document.head.appendChild(styleElement);

    return () => {
      document.head.removeChild(styleElement);
    };
  }, []);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      TextAlign.configure({
        types: ['heading', 'paragraph'],
        alignments: ['left', 'center', 'right', 'justify'],
      }),
      TextStyle,
      Color,
      Link.configure({
        openOnClick: false,
      }),
      Image,
      Placeholder.configure({
        placeholder,
      }),
    ],
    content: value,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
  });

  useEffect(() => {
    if (editor && value !== editor.getHTML()) {
      // Только если значение действительно изменилось
      editor.commands.setContent(value);
    }
  }, [editor, value]);

  if (!editor) {
    return null;
  }

  // Функция для вставки изображения
  const addImage = () => {
    const url = window.prompt('URL изображения');
    if (url) {
      editor.chain().focus().setImage({ src: url }).run();
    }
  };

  // Добавление/редактирование ссылки
  const setLink = () => {
    const previousUrl = editor.getAttributes('link').href;
    const url = window.prompt('URL', previousUrl);

    // Отменить при пустом URL
    if (url === null) {
      return;
    }

    // Удалить ссылку при пустой строке
    if (url === '') {
      editor.chain().focus().unsetLink().run();
      return;
    }

    // Если ничего не выбрано, но есть ссылка под курсором
    if (editor.view.state.selection.empty && previousUrl) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      
      if (url) {
        editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
      }
      return;
    }

    // Если текст не выбран, спросить текст ссылки
    if (editor.view.state.selection.empty) {
      const text = window.prompt('Текст ссылки');
      if (text) {
        editor
          .chain()
          .focus()
          .insertContent(`<a href="${url}">${text}</a>`)
          .run();
      }
      return;
    }

    // Если текст выбран, просто добавить ссылку
    editor.chain().focus().setLink({ href: url }).run();
  };

  // Функция для обработки нажатия Enter
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      // Добавляем новый параграф
      editor.commands.createParagraphNear();
    }
  }

  const colors = [
    '#000000', '#D81B60', '#1E88E5', '#43A047', 
    '#6D4C41', '#546E7A', '#F4511E', '#FB8C00', 
    '#FFB300', '#C0CA33', '#7CB342', '#8E24AA'
  ]

  return (
    <div 
      className={cn("resizable-editor", className, { "resize-both": enableResize })} 
      ref={editorContainerRef}
      style={{ minHeight: `${minHeight + 50}px` }}>
      <div className="border-b border-border bg-muted/50 dark:bg-muted/10 p-2 flex flex-wrap gap-1 justify-start items-center">
        <TooltipProvider>
          <ToggleGroup type="multiple" variant="outline" className="flex flex-wrap gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <ToggleGroupItem 
                  value="bold" 
                  size="sm"
                  aria-label="Полужирный" 
                  onClick={() => editor.chain().focus().toggleBold().run()}
                  data-state={editor.isActive('bold') ? 'on' : 'off'}
                >
                  <Bold className="h-4 w-4" />
                </ToggleGroupItem>
              </TooltipTrigger>
              <TooltipContent>Полужирный</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <ToggleGroupItem 
                  value="italic" 
                  size="sm"
                  aria-label="Курсив" 
                  onClick={() => editor.chain().focus().toggleItalic().run()}
                  data-state={editor.isActive('italic') ? 'on' : 'off'}
                >
                  <Italic className="h-4 w-4" />
                </ToggleGroupItem>
              </TooltipTrigger>
              <TooltipContent>Курсив</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <ToggleGroupItem 
                  value="underline" 
                  size="sm"
                  aria-label="Подчеркнутый" 
                  onClick={() => editor.chain().focus().toggleUnderline().run()}
                  data-state={editor.isActive('underline') ? 'on' : 'off'}
                >
                  <UnderlineIcon className="h-4 w-4" />
                </ToggleGroupItem>
              </TooltipTrigger>
              <TooltipContent>Подчеркнутый</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <ToggleGroupItem 
                  value="strike" 
                  size="sm"
                  aria-label="Зачеркнутый" 
                  onClick={() => editor.chain().focus().toggleStrike().run()}
                  data-state={editor.isActive('strike') ? 'on' : 'off'}
                >
                  <Strikethrough className="h-4 w-4" />
                </ToggleGroupItem>
              </TooltipTrigger>
              <TooltipContent>Зачеркнутый</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <ToggleGroupItem 
                  value="code" 
                  size="sm"
                  aria-label="Код" 
                  onClick={() => editor.chain().focus().toggleCode().run()}
                  data-state={editor.isActive('code') ? 'on' : 'off'}
                >
                  <Code className="h-4 w-4" />
                </ToggleGroupItem>
              </TooltipTrigger>
              <TooltipContent>Код</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <ToggleGroupItem 
                  value="blockquote" 
                  size="sm"
                  aria-label="Цитата" 
                  onClick={() => editor.chain().focus().toggleBlockquote().run()}
                  data-state={editor.isActive('blockquote') ? 'on' : 'off'}
                >
                  <Quote className="h-4 w-4" />
                </ToggleGroupItem>
              </TooltipTrigger>
              <TooltipContent>Цитата</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <ToggleGroupItem 
                  value="codeblock" 
                  size="sm"
                  aria-label="Блок кода" 
                  onClick={() => editor.chain().focus().toggleCodeBlock().run()}
                  data-state={editor.isActive('codeBlock') ? 'on' : 'off'}
                >
                  <Code className="h-3 w-3" />
                  <Code className="h-3 w-3 ml-[-2px]" />
                </ToggleGroupItem>
              </TooltipTrigger>
              <TooltipContent>Блок кода</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <ToggleGroupItem 
                  value="spoiler" 
                  size="sm"
                  aria-label="Спойлер (Telegram)" 
                  onClick={() => {
                    const { from, to } = editor.state.selection;
                    if (from === to) {
                      // Если ничего не выбрано, просто вставляем теги
                      editor.chain().focus().insertContent('<tg-spoiler></tg-spoiler>').run();
                    } else {
                      // Если текст выбран, оборачиваем его в теги
                      const selectedText = editor.state.doc.textBetween(from, to);
                      editor.chain().focus().deleteSelection().insertContent(`<tg-spoiler>${selectedText}</tg-spoiler>`).run();
                    }
                  }}
                >
                  <EyeOff className="h-4 w-4" />
                </ToggleGroupItem>
              </TooltipTrigger>
              <TooltipContent>Спойлер (Telegram)</TooltipContent>
            </Tooltip>
          </ToggleGroup>
        
          <div className="mx-1 h-6 w-px bg-border dark:bg-border" />

          <ToggleGroup type="single" variant="outline" className="flex flex-wrap gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <ToggleGroupItem 
                  value="left" 
                  size="sm"
                  aria-label="По левому краю" 
                  onClick={() => editor.chain().focus().setTextAlign('left').run()}
                  data-state={editor.isActive({ textAlign: 'left' }) ? 'on' : 'off'}
                >
                  <AlignLeft className="h-4 w-4" />
                </ToggleGroupItem>
              </TooltipTrigger>
              <TooltipContent>По левому краю</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <ToggleGroupItem 
                  value="center" 
                  size="sm"
                  aria-label="По центру" 
                  onClick={() => editor.chain().focus().setTextAlign('center').run()}
                  data-state={editor.isActive({ textAlign: 'center' }) ? 'on' : 'off'}
                >
                  <AlignCenter className="h-4 w-4" />
                </ToggleGroupItem>
              </TooltipTrigger>
              <TooltipContent>По центру</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <ToggleGroupItem 
                  value="right" 
                  size="sm"
                  aria-label="По правому краю" 
                  onClick={() => editor.chain().focus().setTextAlign('right').run()}
                  data-state={editor.isActive({ textAlign: 'right' }) ? 'on' : 'off'}
                >
                  <AlignRight className="h-4 w-4" />
                </ToggleGroupItem>
              </TooltipTrigger>
              <TooltipContent>По правому краю</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <ToggleGroupItem 
                  value="justify" 
                  size="sm"
                  aria-label="По ширине" 
                  onClick={() => editor.chain().focus().setTextAlign('justify').run()}
                  data-state={editor.isActive({ textAlign: 'justify' }) ? 'on' : 'off'}
                >
                  <AlignJustify className="h-4 w-4" />
                </ToggleGroupItem>
              </TooltipTrigger>
              <TooltipContent>По ширине</TooltipContent>
            </Tooltip>
          </ToggleGroup>

          <div className="mx-1 h-6 w-px bg-border dark:bg-border" />

          {/* Image Button */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button 
                variant="outline" 
                size="sm"
                className="h-8 px-2"
                onClick={addImage}
              >
                <ImageIcon className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Вставить изображение</TooltipContent>
          </Tooltip>

          {/* Link Button */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button 
                variant="outline" 
                size="sm"
                className="h-8 px-2"
                onClick={setLink}
                data-state={editor.isActive('link') ? 'on' : 'off'}
              >
                <LinkIcon className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Вставить ссылку</TooltipContent>
          </Tooltip>

          <div className="mx-1 h-6 w-px bg-border dark:bg-border" />

          {/* Color Picker */}
          <Popover open={colorPickerOpen} onOpenChange={setColorPickerOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-2 flex items-center gap-1"
              >
                <div
                  className="h-4 w-4 rounded-sm border border-input"
                  style={{ backgroundColor: selectedColor }}
                />
                <ChevronRight className="h-3 w-3" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64">
              <div className="space-y-2">
                <Label>Выберите цвет</Label>
                <div className="grid grid-cols-6 gap-2">
                  {colors.map((color) => (
                    <Button
                      key={color}
                      type="button"
                      variant="outline"
                      className="h-8 w-8 p-0 rounded-md"
                      style={{ backgroundColor: color }}
                      onClick={() => {
                        editor.chain().focus().setColor(color).run()
                        setSelectedColor(color)
                        setColorPickerOpen(false)
                      }}
                    />
                  ))}
                </div>
              </div>
            </PopoverContent>
          </Popover>

          {/* Emoji Picker */}
          <div className="mx-1 h-6 w-px bg-border dark:bg-border" />
          
          <EmojiPicker 
            onEmojiSelect={(emoji) => {
              editor.chain().focus().insertContent(emoji).run();
            }} 
          />
          
          {/* Magic Wand Button for AI Text Enhancement */}
          <div className="mx-1 h-6 w-px bg-border dark:bg-border" />
          
          <Tooltip>
            <TooltipTrigger asChild>
              <Button 
                variant="outline" 
                size="sm"
                className="h-8 px-2"
                onClick={() => setIsTextEnhancementOpen(true)}
              >
                <Wand2 className="h-4 w-4 text-primary" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Улучшить текст с помощью AI</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      
      <div className="editor-content relative">
        <EditorContent 
          editor={editor} 
          className={cn(
            "prose prose-sm max-w-none dark:prose-invert min-h-[300px]",
            "prose-headings:text-foreground prose-p:text-foreground",
            "prose-strong:text-foreground prose-em:text-foreground",
            "prose-code:text-foreground prose-pre:bg-muted prose-pre:text-foreground",
            "prose-blockquote:text-muted-foreground prose-blockquote:border-border",
            "prose-a:text-primary hover:prose-a:text-primary/80",
            "prose-img:rounded-md",
            className
          )}
        />
        {enableResize && <div className="resize-handle" />}
      </div>

      {/* Text Enhancement Dialog */}
      <TextEnhancementDialog
        open={isTextEnhancementOpen}
        onOpenChange={setIsTextEnhancementOpen}
        initialText={editor.getHTML()}
        onSave={(enhancedText) => {

          editor.commands.setContent(enhancedText);

          onChange(enhancedText);
        }}
      />
    </div>
  )
}