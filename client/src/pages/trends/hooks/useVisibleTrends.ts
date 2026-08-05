// Фильтрация + сортировка + подготовка вью-модели видимого списка трендов.
// Вынесено из pages/trends/index.tsx: раньше вся эта цепочка
// .filter().filter().sort().map() (с JSON.parse и sources.find на каждый элемент)
// висела прямо в JSX и пересчитывалась на КАЖДЫЙ ре-рендер страницы — отсюда фризы.
// Теперь тяжёлое считается в мемо один раз на изменение реальных зависимостей.

import { useMemo } from "react";
import { detectPlatform, TrendLike } from "../lib/trends-view";

export type SortField =
  | "reactions"
  | "comments"
  | "views"
  | "trendScore"
  | "date"
  | "platform"
  | "none";

export interface VisibleTrend {
  topic: TrendLike;
  isAiTrend: boolean;
  sourceName: string;
  postUrl: string;
  channelUrl: string;
}

interface Params {
  trends: TrendLike[];
  hiddenTrendIds: Set<string>;
  /** Показывать только тренды в закладках (SM-17). */
  onlyBookmarked: boolean;
  searchQuery: string;
  selectedPlatform: string;
  selectedSourceId: string | null;
  sortField: SortField;
  sortDirection: "asc" | "desc";
  sourcesById: Map<string, any>;
  t: (key: string, opts?: any) => string;
}

/**
 * Тренд лежит в закладках? (SM-17)
 *
 * Поле приходит в двух написаниях: snake_case из Directus и camelCase из
 * клиентских мутаций — см. TrendTopic, где объявлены оба. Читаем оба и
 * считаем закладкой ТОЛЬКО настоящий true: undefined, null и строка "true"
 * закладкой не являются, иначе фильтр молча покажет всё подряд.
 */
export function isBookmarkedTrend(topic: any): boolean {
  return topic?.is_bookmarked === true || topic?.isBookmarked === true;
}

function platformBySourceUrl(source: any): string {
  if (!source) return "zz_unknown";
  const url = String(source.url || "").toLowerCase();
  if (url.includes("instagram.com")) return "instagram";
  if (url.includes("vk.com") || url.includes("vkontakte.ru")) return "vk";
  if (url.includes("t.me") || url.includes("telegram.org")) return "telegram";
  if (url.includes("facebook.com") || url.includes("fb.com")) return "facebook";
  return "zz_other";
}

export function useVisibleTrends(params: Params): VisibleTrend[] {
  const {
    trends,
    hiddenTrendIds,
    onlyBookmarked,
    searchQuery,
    selectedPlatform,
    selectedSourceId,
    sortField,
    sortDirection,
    sourcesById,
    t,
  } = params;

  return useMemo(() => {
    if (!Array.isArray(trends)) return [];

    const search = searchQuery.toLowerCase();

    const filtered = trends.filter((topic) => {
      if (hiddenTrendIds.has(topic.id)) return false;
      if (onlyBookmarked && !isBookmarkedTrend(topic)) return false;

      const detected = detectPlatform((topic as any).sourceType || "");
      const matchesSearch = (topic.title || "").toLowerCase().includes(search);
      const platformMatches =
        selectedPlatform === "all" || detected === selectedPlatform;

      let sourceMatches = true;
      if (selectedSourceId) {
        const rawId = (topic as any).sourceId || (topic as any).source_id || "";
        const idStr =
          typeof rawId === "object" && rawId !== null
            ? rawId?.id || String(rawId)
            : String(rawId);
        sourceMatches = idStr === String(selectedSourceId);
      }

      return matchesSearch && platformMatches && sourceMatches;
    });

    const sorted =
      sortField === "none"
        ? filtered
        : [...filtered].sort((a, b) => {
            if (sortField === "platform") {
              const sa = sourcesById.get(
                String((a as any).source_id || (a as any).sourceId),
              );
              const sb = sourcesById.get(
                String((b as any).source_id || (b as any).sourceId),
              );
              const va = platformBySourceUrl(sa);
              const vb = platformBySourceUrl(sb);
              return sortDirection === "asc"
                ? va.localeCompare(vb)
                : vb.localeCompare(va);
            }

            let va = 0;
            let vb = 0;
            switch (sortField) {
              case "reactions":
                va = a.reactions || 0;
                vb = b.reactions || 0;
                break;
              case "comments":
                va = a.comments || 0;
                vb = b.comments || 0;
                break;
              case "views":
                va = a.views || 0;
                vb = b.views || 0;
                break;
              case "trendScore":
                va = a.trendScore || 0;
                vb = b.trendScore || 0;
                break;
              case "date":
                va = new Date(a.created_at || a.createdAt || 0).getTime();
                vb = new Date(b.created_at || b.createdAt || 0).getTime();
                break;
            }
            return sortDirection === "asc" ? va - vb : vb - va;
          });

    // Вью-модель считаем только для итогового (уже отфильтрованного) списка.
    return sorted.map((topic): VisibleTrend => {
      const sourceType =
        (topic as any).sourceType || (topic as any).source_type || "";
      const isAiTrend = sourceType.toString().startsWith("AI:");
      const topicSourceId = (topic as any).source_id || (topic as any).sourceId;
      const foundSource = sourcesById.get(String(topicSourceId));

      const sourceName = isAiTrend
        ? sourceType.replace("AI: ", "")
        : foundSource?.name ||
          topic.sourceName ||
          (topic as any).source_name ||
          (sourceType
            ? sourceType.charAt(0).toUpperCase() + sourceType.slice(1)
            : null) ||
          (topicSourceId
            ? t("trends.trendList.deletedSource")
            : t("trends.trendList.generalTrends"));

      const postUrl = (topic as any).urlPost || topic.url || "";
      const channelUrl =
        foundSource?.url || postUrl.replace(/\/(c\/\d+|\d+)$/, "") || postUrl;

      return { topic, isAiTrend, sourceName, postUrl, channelUrl };
    });
  }, [
    trends,
    hiddenTrendIds,
    onlyBookmarked,
    searchQuery,
    selectedPlatform,
    selectedSourceId,
    sortField,
    sortDirection,
    sourcesById,
    t,
  ]);
}
