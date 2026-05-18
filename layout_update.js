import fs from 'fs';

// Прочитаем файл
const filepath = 'client/src/components/Layout.tsx';
let content = fs.readFileSync(filepath, 'utf8');

// Заменим оба места в коде
content = content.replace(
  /{userIsAdmin && \(\n\s*<Button\n\s*variant="ghost"\n\s*className="w-full justify-start sidebar-item"\n\s*onClick={\(\) => setIsSettingsOpen\(true\)}\n\s*>\n\s*<Settings className="mr-2 h-4 w-4" \/>\n\s*Настройки\n\s*<\/Button>\n\s*\)}/g,
  `{userIsAdmin && (
                  <>
                    <Button
                      variant="ghost"
                      className="w-full justify-start sidebar-item"
                      onClick={() => setIsSettingsOpen(true)}
                    >
                      <Settings className="mr-2 h-4 w-4" />
                      Настройки
                    </Button>
                    <Button
                      variant="ghost"
                      className={\`w-full justify-start sidebar-item \${location === '/admin/global-api-keys' ? 'active' : ''}\`}
                      onClick={() => handleNavigation('/admin/global-api-keys')}
                    >
                      <Key className="mr-2 h-4 w-4" />
                      Глобальные API ключи
                    </Button>
                  </>
                )}`
);

// Запишем обновленный файл
fs.writeFileSync(filepath, content, 'utf8');
console.log('Файл успешно обновлен');
