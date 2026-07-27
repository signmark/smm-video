import { useTranslation } from 'react-i18next';
import { Button } from "@/components/ui/button";
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuTrigger 
} from "@/components/ui/dropdown-menu";
import { Globe } from "lucide-react";

// Короткий код (badge) вместо флаг-эмодзи: Windows рисует 🇬🇧 как «GB»,
// а для английского нужен «EN». Текстовый код одинаково выглядит на всех ОС.
const languages = [
  { code: 'ru', name: 'Русский', short: 'RU' },
  { code: 'en', name: 'English', short: 'EN' },
  { code: 'es', name: 'Español', short: 'ES' }
];

export function LanguageSwitcher() {
  const { i18n } = useTranslation();

  const changeLanguage = (languageCode: string) => {
    i18n.changeLanguage(languageCode);
    localStorage.setItem('language', languageCode);
  };

  const currentLanguage = languages.find(lang => lang.code === i18n.language) || languages[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9"
          data-testid="button-language-toggle"
          title="Выбрать язык / Select language / Seleccionar idioma"
        >
          <Globe className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        {languages.map((language) => (
          <DropdownMenuItem
            key={language.code}
            onClick={() => changeLanguage(language.code)}
            className={`flex items-center gap-2 cursor-pointer ${
              i18n.language === language.code ? 'bg-accent' : ''
            }`}
            data-testid={`lang-${language.code}`}
          >
            <span className="inline-flex h-5 min-w-[1.75rem] items-center justify-center rounded bg-muted px-1 text-xs font-semibold text-muted-foreground">
              {language.short}
            </span>
            <span className="text-sm">{language.name}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
