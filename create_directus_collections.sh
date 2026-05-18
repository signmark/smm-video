#!/bin/bash

echo "Создание коллекций в Directus"

# Получение токена администратора
echo "Получение токена администратора..."
ADMIN_TOKEN=$(curl -s -X POST https://directus.roboflow.tech/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"d1r3ctu5"}' | \
  jq -r '.data.access_token')

if [ "$ADMIN_TOKEN" = "null" ] || [ -z "$ADMIN_TOKEN" ]; then
  echo "Ошибка получения токена администратора"
  exit 1
fi

echo "Токен получен успешно"

# Создание коллекции campaigns
echo "Создание коллекции campaigns..."
curl -s -X POST https://directus.roboflow.tech/collections \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "collection": "campaigns",
    "meta": {
      "collection": "campaigns",
      "icon": "campaign",
      "note": "Кампании пользователей",
      "display_template": "{{name}}",
      "hidden": false,
      "singleton": false,
      "translations": [
        {
          "language": "ru-RU",
          "translation": "Кампании"
        }
      ]
    },
    "schema": {
      "name": "campaigns"
    }
  }'

# Создание полей для campaigns
echo "Создание полей для campaigns..."

# Поле name
curl -s -X POST https://directus.roboflow.tech/fields/campaigns \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "field": "name",
    "type": "string",
    "meta": {
      "field": "name",
      "special": null,
      "interface": "input",
      "options": null,
      "display": null,
      "display_options": null,
      "readonly": false,
      "hidden": false,
      "sort": 1,
      "width": "full",
      "translations": [
        {
          "language": "ru-RU",
          "translation": "Название кампании"
        }
      ],
      "note": "Название кампании"
    },
    "schema": {
      "name": "name",
      "table": "campaigns",
      "data_type": "varchar",
      "default_value": null,
      "max_length": 255,
      "numeric_precision": null,
      "numeric_scale": null,
      "is_nullable": false,
      "is_unique": false,
      "is_primary_key": false,
      "has_auto_increment": false,
      "foreign_key_column": null,
      "foreign_key_table": null
    }
  }'

# Поле description
curl -s -X POST https://directus.roboflow.tech/fields/campaigns \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "field": "description",
    "type": "text",
    "meta": {
      "field": "description",
      "special": null,
      "interface": "input-multiline",
      "options": null,
      "display": null,
      "display_options": null,
      "readonly": false,
      "hidden": false,
      "sort": 2,
      "width": "full",
      "translations": [
        {
          "language": "ru-RU",
          "translation": "Описание"
        }
      ]
    }
  }'

# Поле user_id (связь с пользователем)
curl -s -X POST https://directus.roboflow.tech/fields/campaigns \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "field": "user_id",
    "type": "uuid",
    "meta": {
      "field": "user_id",
      "special": ["m2o"],
      "interface": "select-dropdown-m2o",
      "options": {
        "template": "{{first_name}} {{last_name}} ({{email}})"
      },
      "display": "related-values",
      "display_options": {
        "template": "{{first_name}} {{last_name}}"
      },
      "readonly": false,
      "hidden": false,
      "sort": 3,
      "width": "half",
      "translations": [
        {
          "language": "ru-RU",
          "translation": "Пользователь"
        }
      ]
    }
  }'

# Создание relation для user_id
curl -s -X POST https://directus.roboflow.tech/relations \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "collection": "campaigns",
    "field": "user_id",
    "related_collection": "directus_users"
  }'

# Поле link
curl -s -X POST https://directus.roboflow.tech/fields/campaigns \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "field": "link",
    "type": "string",
    "meta": {
      "field": "link",
      "special": null,
      "interface": "input",
      "options": null,
      "display": null,
      "display_options": null,
      "readonly": false,
      "hidden": false,
      "sort": 4,
      "width": "full",
      "translations": [
        {
          "language": "ru-RU",
          "translation": "Ссылка"
        }
      ]
    }
  }'

# Поле social_media_settings (JSON)
curl -s -X POST https://directus.roboflow.tech/fields/campaigns \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "field": "social_media_settings",
    "type": "json",
    "meta": {
      "field": "social_media_settings",
      "special": ["cast-json"],
      "interface": "input-code",
      "options": {
        "language": "json"
      },
      "display": null,
      "display_options": null,
      "readonly": false,
      "hidden": false,
      "sort": 5,
      "width": "full",
      "translations": [
        {
          "language": "ru-RU",
          "translation": "Настройки соцсетей"
        }
      ]
    }
  }'

# Поле trend_analysis_settings (JSON)
curl -s -X POST https://directus.roboflow.tech/fields/campaigns \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "field": "trend_analysis_settings",
    "type": "json",
    "meta": {
      "field": "trend_analysis_settings",
      "special": ["cast-json"],
      "interface": "input-code",
      "options": {
        "language": "json"
      },
      "display": null,
      "display_options": null,
      "readonly": false,
      "hidden": false,
      "sort": 6,
      "width": "full",
      "translations": [
        {
          "language": "ru-RU",
          "translation": "Настройки анализа трендов"
        }
      ]
    }
  }'

echo "Коллекция campaigns создана"

# Создание коллекции campaign_content
echo "Создание коллекции campaign_content..."
curl -s -X POST https://directus.roboflow.tech/collections \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "collection": "campaign_content",
    "meta": {
      "collection": "campaign_content",
      "icon": "article",
      "note": "Контент кампаний",
      "display_template": "{{title}}",
      "hidden": false,
      "singleton": false,
      "translations": [
        {
          "language": "ru-RU",
          "translation": "Контент кампаний"
        }
      ]
    },
    "schema": {
      "name": "campaign_content"
    }
  }'

# Поля для campaign_content
echo "Создание полей для campaign_content..."

# Поле title
curl -s -X POST https://directus.roboflow.tech/fields/campaign_content \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "field": "title",
    "type": "string",
    "meta": {
      "field": "title",
      "special": null,
      "interface": "input",
      "options": null,
      "display": null,
      "display_options": null,
      "readonly": false,
      "hidden": false,
      "sort": 1,
      "width": "full",
      "translations": [
        {
          "language": "ru-RU",
          "translation": "Заголовок"
        }
      ]
    }
  }'

# Поле content
curl -s -X POST https://directus.roboflow.tech/fields/campaign_content \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "field": "content",
    "type": "text",
    "meta": {
      "field": "content",
      "special": null,
      "interface": "input-rich-text-html",
      "options": null,
      "display": null,
      "display_options": null,
      "readonly": false,
      "hidden": false,
      "sort": 2,
      "width": "full",
      "translations": [
        {
          "language": "ru-RU",
          "translation": "Контент"
        }
      ]
    }
  }'

# Поле campaign_id (связь с кампанией)
curl -s -X POST https://directus.roboflow.tech/fields/campaign_content \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "field": "campaign_id",
    "type": "uuid",
    "meta": {
      "field": "campaign_id",
      "special": ["m2o"],
      "interface": "select-dropdown-m2o",
      "options": {
        "template": "{{name}}"
      },
      "display": "related-values",
      "display_options": {
        "template": "{{name}}"
      },
      "readonly": false,
      "hidden": false,
      "sort": 3,
      "width": "half",
      "translations": [
        {
          "language": "ru-RU",
          "translation": "Кампания"
        }
      ]
    }
  }'

# Создание relation для campaign_id
curl -s -X POST https://directus.roboflow.tech/relations \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "collection": "campaign_content",
    "field": "campaign_id",
    "related_collection": "campaigns"
  }'

# Поле user_id для campaign_content
curl -s -X POST https://directus.roboflow.tech/fields/campaign_content \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "field": "user_id",
    "type": "uuid",
    "meta": {
      "field": "user_id",
      "special": ["m2o"],
      "interface": "select-dropdown-m2o",
      "options": {
        "template": "{{first_name}} {{last_name}} ({{email}})"
      },
      "display": "related-values",
      "display_options": {
        "template": "{{first_name}} {{last_name}}"
      },
      "readonly": false,
      "hidden": false,
      "sort": 4,
      "width": "half",
      "translations": [
        {
          "language": "ru-RU",
          "translation": "Пользователь"
        }
      ]
    }
  }'

# Создание relation для user_id в campaign_content
curl -s -X POST https://directus.roboflow.tech/relations \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "collection": "campaign_content",
    "field": "user_id",
    "related_collection": "directus_users"
  }'

# Поле status
curl -s -X POST https://directus.roboflow.tech/fields/campaign_content \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "field": "status",
    "type": "string",
    "meta": {
      "field": "status",
      "special": null,
      "interface": "select-dropdown",
      "options": {
        "choices": [
          {"text": "Черновик", "value": "draft"},
          {"text": "Запланировано", "value": "scheduled"},
          {"text": "Опубликовано", "value": "published"}
        ]
      },
      "display": null,
      "display_options": null,
      "readonly": false,
      "hidden": false,
      "sort": 5,
      "width": "half",
      "translations": [
        {
          "language": "ru-RU",
          "translation": "Статус"
        }
      ]
    },
    "schema": {
      "default_value": "draft"
    }
  }'

# Поле content_type
curl -s -X POST https://directus.roboflow.tech/fields/campaign_content \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "field": "content_type",
    "type": "string",
    "meta": {
      "field": "content_type",
      "special": null,
      "interface": "select-dropdown",
      "options": {
        "choices": [
          {"text": "Текст", "value": "text"},
          {"text": "Текст с изображением", "value": "text-image"},
          {"text": "Видео", "value": "video"},
          {"text": "Видео с текстом", "value": "video-text"}
        ]
      },
      "display": null,
      "display_options": null,
      "readonly": false,
      "hidden": false,
      "sort": 6,
      "width": "half",
      "translations": [
        {
          "language": "ru-RU",
          "translation": "Тип контента"
        }
      ]
    }
  }'

# Поле image_url
curl -s -X POST https://directus.roboflow.tech/fields/campaign_content \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "field": "image_url",
    "type": "string",
    "meta": {
      "field": "image_url",
      "special": null,
      "interface": "input",
      "options": null,
      "display": null,
      "display_options": null,
      "readonly": false,
      "hidden": false,
      "sort": 7,
      "width": "full",
      "translations": [
        {
          "language": "ru-RU",
          "translation": "URL изображения"
        }
      ]
    }
  }'

# Поле video_url
curl -s -X POST https://directus.roboflow.tech/fields/campaign_content \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "field": "video_url",
    "type": "string",
    "meta": {
      "field": "video_url",
      "special": null,
      "interface": "input",
      "options": null,
      "display": null,
      "display_options": null,
      "readonly": false,
      "hidden": false,
      "sort": 8,
      "width": "full",
      "translations": [
        {
          "language": "ru-RU",
          "translation": "URL видео"
        }
      ]
    }
  }'

# Поле keywords (массив)
curl -s -X POST https://directus.roboflow.tech/fields/campaign_content \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "field": "keywords",
    "type": "json",
    "meta": {
      "field": "keywords",
      "special": ["cast-json"],
      "interface": "tags",
      "options": null,
      "display": "tags",
      "display_options": null,
      "readonly": false,
      "hidden": false,
      "sort": 9,
      "width": "full",
      "translations": [
        {
          "language": "ru-RU",
          "translation": "Ключевые слова"
        }
      ]
    }
  }'

# Поле hashtags (массив)
curl -s -X POST https://directus.roboflow.tech/fields/campaign_content \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "field": "hashtags",
    "type": "json",
    "meta": {
      "field": "hashtags",
      "special": ["cast-json"],
      "interface": "tags",
      "options": null,
      "display": "tags",
      "display_options": null,
      "readonly": false,
      "hidden": false,
      "sort": 10,
      "width": "full",
      "translations": [
        {
          "language": "ru-RU",
          "translation": "Хештеги"
        }
      ]
    }
  }'

# Поле scheduled_at
curl -s -X POST https://directus.roboflow.tech/fields/campaign_content \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "field": "scheduled_at",
    "type": "timestamp",
    "meta": {
      "field": "scheduled_at",
      "special": null,
      "interface": "datetime",
      "options": null,
      "display": "datetime",
      "display_options": null,
      "readonly": false,
      "hidden": false,
      "sort": 11,
      "width": "half",
      "translations": [
        {
          "language": "ru-RU",
          "translation": "Время публикации"
        }
      ]
    }
  }'

# Поле social_platforms (JSON)
curl -s -X POST https://directus.roboflow.tech/fields/campaign_content \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "field": "social_platforms",
    "type": "json",
    "meta": {
      "field": "social_platforms",
      "special": ["cast-json"],
      "interface": "input-code",
      "options": {
        "language": "json"
      },
      "display": null,
      "display_options": null,
      "readonly": false,
      "hidden": false,
      "sort": 12,
      "width": "full",
      "translations": [
        {
          "language": "ru-RU",
          "translation": "Данные платформ"
        }
      ]
    }
  }'

echo "Коллекция campaign_content создана"

# Создание коллекции content_sources
echo "Создание коллекции content_sources..."
curl -s -X POST https://directus.roboflow.tech/collections \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "collection": "content_sources",
    "meta": {
      "collection": "content_sources",
      "icon": "source",
      "note": "Источники контента",
      "display_template": "{{name}}",
      "hidden": false,
      "singleton": false,
      "translations": [
        {
          "language": "ru-RU",
          "translation": "Источники контента"
        }
      ]
    },
    "schema": {
      "name": "content_sources"
    }
  }'

# Поля для content_sources
echo "Создание полей для content_sources..."

# Поле name
curl -s -X POST https://directus.roboflow.tech/fields/content_sources \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "field": "name",
    "type": "string",
    "meta": {
      "field": "name",
      "special": null,
      "interface": "input",
      "options": null,
      "display": null,
      "display_options": null,
      "readonly": false,
      "hidden": false,
      "sort": 1,
      "width": "full",
      "translations": [
        {
          "language": "ru-RU",
          "translation": "Название источника"
        }
      ]
    }
  }'

# Поле url
curl -s -X POST https://directus.roboflow.tech/fields/content_sources \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "field": "url",
    "type": "string",
    "meta": {
      "field": "url",
      "special": null,
      "interface": "input",
      "options": null,
      "display": null,
      "display_options": null,
      "readonly": false,
      "hidden": false,
      "sort": 2,
      "width": "full",
      "translations": [
        {
          "language": "ru-RU",
          "translation": "URL источника"
        }
      ]
    }
  }'

# Поле type
curl -s -X POST https://directus.roboflow.tech/fields/content_sources \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "field": "type",
    "type": "string",
    "meta": {
      "field": "type",
      "special": null,
      "interface": "select-dropdown",
      "options": {
        "choices": [
          {"text": "Instagram", "value": "instagram"},
          {"text": "Telegram", "value": "telegram"},
          {"text": "VK", "value": "vk"},
          {"text": "Facebook", "value": "facebook"}
        ]
      },
      "display": null,
      "display_options": null,
      "readonly": false,
      "hidden": false,
      "sort": 3,
      "width": "half",
      "translations": [
        {
          "language": "ru-RU",
          "translation": "Тип источника"
        }
      ]
    }
  }'

# Поле campaign_id для content_sources
curl -s -X POST https://directus.roboflow.tech/fields/content_sources \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "field": "campaign_id",
    "type": "uuid",
    "meta": {
      "field": "campaign_id",
      "special": ["m2o"],
      "interface": "select-dropdown-m2o",
      "options": {
        "template": "{{name}}"
      },
      "display": "related-values",
      "display_options": {
        "template": "{{name}}"
      },
      "readonly": false,
      "hidden": false,
      "sort": 4,
      "width": "half",
      "translations": [
        {
          "language": "ru-RU",
          "translation": "Кампания"
        }
      ]
    }
  }'

# Создание relation для campaign_id в content_sources
curl -s -X POST https://directus.roboflow.tech/relations \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "collection": "content_sources",
    "field": "campaign_id",
    "related_collection": "campaigns"
  }'

# Поле user_id для content_sources
curl -s -X POST https://directus.roboflow.tech/fields/content_sources \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "field": "user_id",
    "type": "uuid",
    "meta": {
      "field": "user_id",
      "special": ["m2o"],
      "interface": "select-dropdown-m2o",
      "options": {
        "template": "{{first_name}} {{last_name}} ({{email}})"
      },
      "display": "related-values",
      "display_options": {
        "template": "{{first_name}} {{last_name}}"
      },
      "readonly": false,
      "hidden": false,
      "sort": 5,
      "width": "half",
      "translations": [
        {
          "language": "ru-RU",
          "translation": "Пользователь"
        }
      ]
    }
  }'

# Создание relation для user_id в content_sources
curl -s -X POST https://directus.roboflow.tech/relations \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "collection": "content_sources",
    "field": "user_id",
    "related_collection": "directus_users"
  }'

# Поле is_active
curl -s -X POST https://directus.roboflow.tech/fields/content_sources \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "field": "is_active",
    "type": "boolean",
    "meta": {
      "field": "is_active",
      "special": null,
      "interface": "boolean",
      "options": null,
      "display": "boolean",
      "display_options": null,
      "readonly": false,
      "hidden": false,
      "sort": 6,
      "width": "half",
      "translations": [
        {
          "language": "ru-RU",
          "translation": "Активный"
        }
      ]
    },
    "schema": {
      "default_value": true
    }
  }'

echo "Коллекция content_sources создана"

# Создание коллекции business_questionnaire
echo "Создание коллекции business_questionnaire..."
curl -s -X POST https://directus.roboflow.tech/collections \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "collection": "business_questionnaire",
    "meta": {
      "collection": "business_questionnaire",
      "icon": "assignment",
      "note": "Анкеты бизнеса",
      "display_template": "{{company_name}}",
      "hidden": false,
      "singleton": false,
      "translations": [
        {
          "language": "ru-RU",
          "translation": "Анкеты бизнеса"
        }
      ]
    },
    "schema": {
      "name": "business_questionnaire"
    }
  }'

# Поля для business_questionnaire
echo "Создание полей для business_questionnaire..."

# Поле campaign_id
curl -s -X POST https://directus.roboflow.tech/fields/business_questionnaire \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "field": "campaign_id",
    "type": "uuid",
    "meta": {
      "field": "campaign_id",
      "special": ["m2o"],
      "interface": "select-dropdown-m2o",
      "options": {
        "template": "{{name}}"
      },
      "display": "related-values",
      "display_options": {
        "template": "{{name}}"
      },
      "readonly": false,
      "hidden": false,
      "sort": 1,
      "width": "full",
      "translations": [
        {
          "language": "ru-RU",
          "translation": "Кампания"
        }
      ]
    }
  }'

# Создание relation для campaign_id в business_questionnaire
curl -s -X POST https://directus.roboflow.tech/relations \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "collection": "business_questionnaire",
    "field": "campaign_id",
    "related_collection": "campaigns"
  }'

# Поле company_name
curl -s -X POST https://directus.roboflow.tech/fields/business_questionnaire \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "field": "company_name",
    "type": "string",
    "meta": {
      "field": "company_name",
      "special": null,
      "interface": "input",
      "options": null,
      "display": null,
      "display_options": null,
      "readonly": false,
      "hidden": false,
      "sort": 2,
      "width": "full",
      "translations": [
        {
          "language": "ru-RU",
          "translation": "Название компании"
        }
      ]
    }
  }'

# Поле contact_info
curl -s -X POST https://directus.roboflow.tech/fields/business_questionnaire \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "field": "contact_info",
    "type": "text",
    "meta": {
      "field": "contact_info",
      "special": null,
      "interface": "input-multiline",
      "options": null,
      "display": null,
      "display_options": null,
      "readonly": false,
      "hidden": false,
      "sort": 3,
      "width": "full",
      "translations": [
        {
          "language": "ru-RU",
          "translation": "Контактная информация"
        }
      ]
    }
  }'

# Поле business_description
curl -s -X POST https://directus.roboflow.tech/fields/business_questionnaire \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "field": "business_description",
    "type": "text",
    "meta": {
      "field": "business_description",
      "special": null,
      "interface": "input-multiline",
      "options": null,
      "display": null,
      "display_options": null,
      "readonly": false,
      "hidden": false,
      "sort": 4,
      "width": "full",
      "translations": [
        {
          "language": "ru-RU",
          "translation": "Описание бизнеса"
        }
      ]
    }
  }'

echo "Коллекция business_questionnaire создана"

# Создание коллекции campaign_trend_topics
echo "Создание коллекции campaign_trend_topics..."
curl -s -X POST https://directus.roboflow.tech/collections \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "collection": "campaign_trend_topics",
    "meta": {
      "collection": "campaign_trend_topics",
      "icon": "trending_up",
      "note": "Трендовые темы кампаний",
      "display_template": "{{title}}",
      "hidden": false,
      "singleton": false,
      "translations": [
        {
          "language": "ru-RU",
          "translation": "Трендовые темы"
        }
      ]
    },
    "schema": {
      "name": "campaign_trend_topics"
    }
  }'

# Поля для campaign_trend_topics
echo "Создание полей для campaign_trend_topics..."

# Поле title
curl -s -X POST https://directus.roboflow.tech/fields/campaign_trend_topics \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "field": "title",
    "type": "string",
    "meta": {
      "field": "title",
      "special": null,
      "interface": "input",
      "options": null,
      "display": null,
      "display_options": null,
      "readonly": false,
      "hidden": false,
      "sort": 1,
      "width": "full",
      "translations": [
        {
          "language": "ru-RU",
          "translation": "Заголовок тренда"
        }
      ]
    }
  }'

# Поле source_id
curl -s -X POST https://directus.roboflow.tech/fields/campaign_trend_topics \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "field": "source_id",
    "type": "string",
    "meta": {
      "field": "source_id",
      "special": null,
      "interface": "input",
      "options": null,
      "display": null,
      "display_options": null,
      "readonly": false,
      "hidden": false,
      "sort": 2,
      "width": "half",
      "translations": [
        {
          "language": "ru-RU",
          "translation": "ID источника"
        }
      ]
    }
  }'

# Поле campaign_id
curl -s -X POST https://directus.roboflow.tech/fields/campaign_trend_topics \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "field": "campaign_id",
    "type": "uuid",
    "meta": {
      "field": "campaign_id",
      "special": ["m2o"],
      "interface": "select-dropdown-m2o",
      "options": {
        "template": "{{name}}"
      },
      "display": "related-values",
      "display_options": {
        "template": "{{name}}"
      },
      "readonly": false,
      "hidden": false,
      "sort": 3,
      "width": "half",
      "translations": [
        {
          "language": "ru-RU",
          "translation": "Кампания"
        }
      ]
    }
  }'

# Создание relation для campaign_id в campaign_trend_topics
curl -s -X POST https://directus.roboflow.tech/relations \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "collection": "campaign_trend_topics",
    "field": "campaign_id",
    "related_collection": "campaigns"
  }'

# Поле reactions
curl -s -X POST https://directus.roboflow.tech/fields/campaign_trend_topics \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "field": "reactions",
    "type": "integer",
    "meta": {
      "field": "reactions",
      "special": null,
      "interface": "input",
      "options": null,
      "display": null,
      "display_options": null,
      "readonly": false,
      "hidden": false,
      "sort": 4,
      "width": "third",
      "translations": [
        {
          "language": "ru-RU",
          "translation": "Реакции"
        }
      ]
    },
    "schema": {
      "default_value": 0
    }
  }'

# Поле comments
curl -s -X POST https://directus.roboflow.tech/fields/campaign_trend_topics \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "field": "comments",
    "type": "integer",
    "meta": {
      "field": "comments",
      "special": null,
      "interface": "input",
      "options": null,
      "display": null,
      "display_options": null,
      "readonly": false,
      "hidden": false,
      "sort": 5,
      "width": "third",
      "translations": [
        {
          "language": "ru-RU",
          "translation": "Комментарии"
        }
      ]
    },
    "schema": {
      "default_value": 0
    }
  }'

# Поле views
curl -s -X POST https://directus.roboflow.tech/fields/campaign_trend_topics \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "field": "views",
    "type": "integer",
    "meta": {
      "field": "views",
      "special": null,
      "interface": "input",
      "options": null,
      "display": null,
      "display_options": null,
      "readonly": false,
      "hidden": false,
      "sort": 6,
      "width": "third",
      "translations": [
        {
          "language": "ru-RU",
          "translation": "Просмотры"
        }
      ]
    },
    "schema": {
      "default_value": 0
    }
  }'

# Поле is_bookmarked
curl -s -X POST https://directus.roboflow.tech/fields/campaign_trend_topics \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "field": "is_bookmarked",
    "type": "boolean",
    "meta": {
      "field": "is_bookmarked",
      "special": null,
      "interface": "boolean",
      "options": null,
      "display": "boolean",
      "display_options": null,
      "readonly": false,
      "hidden": false,
      "sort": 7,
      "width": "half",
      "translations": [
        {
          "language": "ru-RU",
          "translation": "В закладках"
        }
      ]
    },
    "schema": {
      "default_value": false
    }
  }'

# Поле media_links (JSON)
curl -s -X POST https://directus.roboflow.tech/fields/campaign_trend_topics \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "field": "media_links",
    "type": "json",
    "meta": {
      "field": "media_links",
      "special": ["cast-json"],
      "interface": "input-code",
      "options": {
        "language": "json"
      },
      "display": null,
      "display_options": null,
      "readonly": false,
      "hidden": false,
      "sort": 8,
      "width": "full",
      "translations": [
        {
          "language": "ru-RU",
          "translation": "Медиа ссылки"
        }
      ]
    }
  }'

echo "Коллекция campaign_trend_topics создана"

# Создание коллекции global_api_keys
echo "Создание коллекции global_api_keys..."
curl -s -X POST https://directus.roboflow.tech/collections \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "collection": "global_api_keys",
    "meta": {
      "collection": "global_api_keys",
      "icon": "vpn_key",
      "note": "Глобальные API ключи",
      "display_template": "{{service_name}}",
      "hidden": false,
      "singleton": false,
      "translations": [
        {
          "language": "ru-RU",
          "translation": "API ключи"
        }
      ]
    },
    "schema": {
      "name": "global_api_keys"
    }
  }'

# Поля для global_api_keys
echo "Создание полей для global_api_keys..."

# Поле service_name
curl -s -X POST https://directus.roboflow.tech/fields/global_api_keys \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "field": "service_name",
    "type": "string",
    "meta": {
      "field": "service_name",
      "special": null,
      "interface": "input",
      "options": null,
      "display": null,
      "display_options": null,
      "readonly": false,
      "hidden": false,
      "sort": 1,
      "width": "half",
      "translations": [
        {
          "language": "ru-RU",
          "translation": "Название сервиса"
        }
      ]
    }
  }'

# Поле api_key
curl -s -X POST https://directus.roboflow.tech/fields/global_api_keys \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "field": "api_key",
    "type": "hash",
    "meta": {
      "field": "api_key",
      "special": ["hash"],
      "interface": "input-hash",
      "options": null,
      "display": null,
      "display_options": null,
      "readonly": false,
      "hidden": false,
      "sort": 2,
      "width": "full",
      "translations": [
        {
          "language": "ru-RU",
          "translation": "API ключ"
        }
      ]
    }
  }'

# Поле is_active
curl -s -X POST https://directus.roboflow.tech/fields/global_api_keys \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "field": "is_active",
    "type": "boolean",
    "meta": {
      "field": "is_active",
      "special": null,
      "interface": "boolean",
      "options": null,
      "display": "boolean",
      "display_options": null,
      "readonly": false,
      "hidden": false,
      "sort": 3,
      "width": "half",
      "translations": [
        {
          "language": "ru-RU",
          "translation": "Активный"
        }
      ]
    },
    "schema": {
      "default_value": true
    }
  }'

echo "Коллекция global_api_keys создана"

# Добавление поля is_smm_admin к пользователям
echo "Добавление поля is_smm_admin к пользователям..."
curl -s -X POST https://directus.roboflow.tech/fields/directus_users \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "field": "is_smm_admin",
    "type": "boolean",
    "meta": {
      "field": "is_smm_admin",
      "special": null,
      "interface": "boolean",
      "options": null,
      "display": "boolean",
      "display_options": null,
      "readonly": false,
      "hidden": false,
      "sort": 100,
      "width": "half",
      "translations": [
        {
          "language": "ru-RU",
          "translation": "SMM Администратор"
        }
      ],
      "note": "Пометка для SMM администраторов"
    },
    "schema": {
      "default_value": false
    }
  }'

echo "Поле is_smm_admin добавлено к пользователям"

echo ""
echo "✅ Все коллекции созданы успешно!"
echo ""
echo "Созданные коллекции:"
echo "- campaigns (Кампании)"
echo "- campaign_content (Контент кампаний)"
echo "- content_sources (Источники контента)"
echo "- business_questionnaire (Анкеты бизнеса)"
echo "- campaign_trend_topics (Трендовые темы)"
echo "- global_api_keys (API ключи)"
echo ""
echo "Добавленные поля к пользователям:"
echo "- is_smm_admin (SMM Администратор)"