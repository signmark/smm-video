#!/bin/bash

# Цвета для удобного отображения информации
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${YELLOW}===== Установка и проверка AWS SDK для S3 =====${NC}"

# Устанавливаем AWS SDK пакеты явно указывая версии
echo -e "${YELLOW}Установка AWS SDK пакетов...${NC}"
npm install --save \
  @aws-sdk/client-s3@3.787.0 \
  @aws-sdk/lib-storage@3.787.0 \
  @aws-sdk/s3-request-presigner@3.787.0

# Проверяем результат установки
if [ $? -eq 0 ]; then
  echo -e "${GREEN}Пакеты успешно установлены через npm install${NC}"
else
  echo -e "${RED}Ошибка при установке пакетов через npm install${NC}"
  
  # Пробуем альтернативный метод - yarn
  echo -e "${YELLOW}Пробуем установить через yarn...${NC}"
  yarn add \
    @aws-sdk/client-s3@3.787.0 \
    @aws-sdk/lib-storage@3.787.0 \
    @aws-sdk/s3-request-presigner@3.787.0
  
  if [ $? -eq 0 ]; then
    echo -e "${GREEN}Пакеты успешно установлены через yarn${NC}"
  else
    echo -e "${RED}Ошибка при установке пакетов через yarn${NC}"
    exit 1
  fi
fi

# Проверяем возможность импорта модулей
echo -e "${YELLOW}Проверка импорта AWS SDK модулей...${NC}"

# Проверка client-s3
echo -e "${YELLOW}Проверка @aws-sdk/client-s3...${NC}"
node -e "try { console.log(require('@aws-sdk/client-s3').S3Client); console.log('✅ @aws-sdk/client-s3 импортирован успешно'); } catch (e) { console.error('❌ Ошибка импорта @aws-sdk/client-s3:', e); process.exit(1); }"

# Проверка lib-storage
echo -e "${YELLOW}Проверка @aws-sdk/lib-storage...${NC}"
node -e "try { console.log(require('@aws-sdk/lib-storage').Upload); console.log('✅ @aws-sdk/lib-storage импортирован успешно'); } catch (e) { console.error('❌ Ошибка импорта @aws-sdk/lib-storage:', e); process.exit(1); }"

# Проверка s3-request-presigner
echo -e "${YELLOW}Проверка @aws-sdk/s3-request-presigner...${NC}"
node -e "try { console.log(require('@aws-sdk/s3-request-presigner').getSignedUrl); console.log('✅ @aws-sdk/s3-request-presigner импортирован успешно'); } catch (e) { console.error('❌ Ошибка импорта @aws-sdk/s3-request-presigner:', e); process.exit(1); }"

# Выводим информацию об установленных пакетах
echo -e "${YELLOW}Информация о пакетах AWS SDK:${NC}"
npm ls @aws-sdk/client-s3 @aws-sdk/lib-storage @aws-sdk/s3-request-presigner

echo -e "${GREEN}===== Установка и проверка AWS SDK завершена успешно =====${NC}"

# Проверяем, есть ли в ридми информация об этом скрипте
if [ -f "README.md" ]; then
  if grep -q "install-aws-sdk.sh" README.md; then
    echo -e "${GREEN}Документация в README.md уже содержит информацию о скрипте${NC}"
  else
    echo -e "${YELLOW}Добавление информации о скрипте в README.md...${NC}"
    echo -e "\n## AWS SDK для S3\n\nДля установки и проверки AWS SDK пакетов выполните скрипт:\n\n\`\`\`bash\nbash install-aws-sdk.sh\n\`\`\`\n\nЭто обеспечит корректную работу с Beget S3." >> README.md
    echo -e "${GREEN}Информация добавлена в README.md${NC}"
  fi
fi

# Делаем скрипт исполняемым
chmod +x install-aws-sdk.sh