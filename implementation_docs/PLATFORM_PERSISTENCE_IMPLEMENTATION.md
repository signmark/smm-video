# Документация: Исправление сохранения данных между платформами

## Описание проблемы и решения
В системе публикации контента в социальные сети была выявлена критическая проблема: при обновлении статуса публикации для одной платформы терялись данные о публикациях в других платформах. Например, если контент успешно публиковался сначала в Telegram, а затем в VK, то в процессе обновления статуса для VK информация о публикации в Telegram полностью терялась.

Реализовано решение этой проблемы - правильный подход к обновлению объекта `social_platforms` для сохранения данных всех платформ.

## Обзор метода updatePublicationStatus

Метод `updatePublicationStatus` в классе `SocialPublishingWithImgurService` отвечает за обновление статуса публикации контента в конкретной социальной платформе. Он принимает:
- `contentId`: идентификатор контента
- `platform`: целевая социальная платформа (telegram, vk, instagram и т.д.)
- `publicationResult`: результат публикации (статус, дата, ссылка на пост и т.д.)

## Алгоритм работы метода

1. **Получение системного токена администратора**
   ```typescript
   const systemToken = await this.getSystemToken();
   ```
   Необходим для авторизованного доступа к API Directus.

2. **Получение текущего контента из Directus**
   ```typescript
   const response = await axios.get(`${directusUrl}/items/campaign_content/${contentId}`, {
     headers: {
       'Authorization': `Bearer ${systemToken}`
     }
   });
   ```
   Извлекаем существующие данные о контенте, включая текущее состояние social_platforms.

3. **Преобразование данных в формат CampaignContent**
   ```typescript
   content = {
     id: item.id,
     /* другие поля */
     socialPlatforms: item.social_platforms || {},
     /* дополнительные поля */
   };
   ```
   Преобразование данных из формата хранения Directus в объектную модель приложения.

4. **Обновление статуса публикации для конкретной платформы с глубоким копированием**
   ```typescript
   const socialPlatforms = content.socialPlatforms || {};
   
   // Создаем глубокую копию объекта socialPlatforms
   const updatedSocialPlatforms = JSON.parse(JSON.stringify(socialPlatforms));
   
   // Обновляем или добавляем только данные конкретной платформы
   updatedSocialPlatforms[platform] = {
     // Сохраняем существующие данные платформы
     ...(updatedSocialPlatforms[platform] || {}),
     // Обновляем актуальные данные
     status: publicationResult.status,
     publishedAt: publicationResult.publishedAt ? new Date(publicationResult.publishedAt).toISOString() : null,
     error: publicationResult.error || null,
     // Добавляем дополнительные данные из publicationResult
     ...(publicationResult.postUrl ? { postUrl: publicationResult.postUrl } : {}),
     ...(publicationResult.postId ? { postId: publicationResult.postId } : {}),
     ...(publicationResult.messageId ? { messageId: publicationResult.messageId } : {})
   };
   ```
   
   Ключевые улучшения:
   1. Использование глубокого копирования для полной изоляции данных и избежания ссылок на общие объекты
   2. Сохранение существующих данных платформы через spread-оператор
   3. Добавление дополнительных данных из результата публикации только если они существуют

5. **Отправка обновления в Directus с улучшенным логированием**
   ```typescript
   // Логирование для диагностики
   log(`Обновляем social_platforms для ${contentId}:\n${JSON.stringify(updatedSocialPlatforms, null, 2)}`, 'social-publishing');
   
   const updateResponse = await axios.patch(`${directusUrl}/items/campaign_content/${contentId}`, {
     social_platforms: updatedSocialPlatforms
   }, {
     headers: {
       'Authorization': `Bearer ${systemToken}`,
       'Content-Type': 'application/json'
     }
   });
   ```
   Обновление поля social_platforms с полной информацией о всех платформах.

## Преимущества реализации
1. **Полное сохранение данных всех платформ**: Глубокое копирование и обновление только целевой платформы гарантирует, что данные о других платформах не будут потеряны.
2. **Сохранение дополнительных полей результата**: Сохраняются все важные поля из результата публикации (postUrl, postId, messageId).
3. **Улучшенное логирование**: Добавлено подробное логирование для диагностики проблем.
4. **Обратная совместимость**: Реализация поддерживает текущую структуру данных без изменения схемы.

## Связанные изменения
Это исправление относится к улучшению логики обновления статуса публикации и дополняет ранее внесенное исправление планировщика публикаций, которое обеспечивает продолжение попыток публикации для всех платформ даже после успешной публикации в одну из них.