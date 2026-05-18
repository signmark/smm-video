#!/bin/bash

# API документация
mv API_ARCHITECTURE_GUIDE.md API_INTEGRATION.md API_INTEGRATIONS_UPDATE.md API_KEYS_STORAGE_POLICY.md docs/api/

# Социальные сети
mv FACEBOOK_* INSTAGRAM_* TELEGRAM_* docs/social_media/
mv WEBHOOK_INTEGRATION_CHANGES.md webhook-migration-code-changes.md N8N_WEBHOOK_MIGRATION_GUIDE.md docs/social_media/
mv AUTOMATED_SOCIAL_MEDIA_ROADMAP.md docs/social_media/
mv MULTI_PLATFORM_SCHEDULING_FIX.md docs/social_media/

# Хранилище
mv BEGET_S3_* LOCAL_AWS_SDK_GUIDE.md docs/storage/

# AI Интеграции
mv AI_MODEL_INTEGRATION_GUIDE.md AI_MODEL_INTEGRATION_PLAN.md FAL_AI_MODELS_INTEGRATION_GUIDE.md docs/ai/

# Развертывание
mv deploy-instructions.md docs/deployment/
mv SERVER_STARTUP_ISSUES.md docs/deployment/

# Технические документы
mv TECHNICAL_* docs/technical/
mv PLATFORM_PERSISTENCE_IMPLEMENTATION.md docs/technical/
mv ANALYTICS_* docs/technical/

# Проектные документы
mv commercial_proposal_*.md detailed_project_prompt_*.md docs/project/
mv DAILY_REPORTS.md TASKS_FOR_TOMORROW.md docs/project/

# Тестирование
mv TEST_SETUP_GUIDE.md test-telegram-result.md TELEGRAM_TESTING.md docs/testing/
