/**
 * Задача 108 — ПОВЕДЕНЧЕСКИЙ тест на то, что планировщик действительно закрывает
 * зависшую запись, а не только «умеет решать».
 *
 * Отдельный файл от `publication-terminal-state.test.ts` намеренно: там проверяется
 * решение (чистая функция), здесь — что планировщик его вызывает и записывает
 * результат в Directus, а публикацию при этом НЕ затевает.
 *
 * Мутация, которая обязана красить: убрать вызов `finalizeStuckContent` из разбора —
 * падает и статус в обновлении, и утверждение «публикацию не пытались начать».
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("axios", () => ({
  default: {
    post: vi.fn(),
    get: vi.fn(),
    patch: vi.fn(),
    create: vi.fn().mockReturnValue({
      interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
    }),
  },
}));
vi.mock("../utils/logger");
vi.mock("../utils/content-cache", () => ({ invalidateContentCache: vi.fn() }));
vi.mock("../services/directus-crud", () => ({
  directusCrud: { list: vi.fn(), update: vi.fn(), getById: vi.fn(), create: vi.fn() },
}));
vi.mock("../services/publication-lock-manager", () => ({
  publicationLockManager: {
    isLocked: vi.fn().mockReturnValue(false),
    acquireLock: vi.fn().mockResolvedValue(true),
    releaseLock: vi.fn().mockResolvedValue(true),
  },
}));
vi.mock("../services/publication-tracking", () => ({
  publicationTracker: {
    canPublish: vi.fn().mockResolvedValue(true),
    markAsProcessed: vi.fn().mockResolvedValue(true),
    releasePublication: vi.fn().mockResolvedValue(true),
  },
}));
vi.mock("../index", () => ({ broadcastNotification: vi.fn() }));

import { getPublishScheduler } from "../services/publish-scheduler";
import { directusCrud } from "../services/directus-crud";

const scheduler = getPublishScheduler();

/** Все обновления записи, дошедшие до Directus. */
function updatesFor(id: string): any[] {
  return vi
    .mocked(directusCrud.update)
    .mock.calls.filter((c) => c[0] === "campaign_content" && c[1] === id)
    .map((c) => c[2]);
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.DIRECTUS_URL = "http://directus.test";
  // @ts-ignore приватный кэш прошлых прогонов
  scheduler.processedContentCache.clear();
  // @ts-ignore планировщик мог остаться «занят» после упавшего теста
  scheduler.isProcessing = false;
});

describe("Задача 108: планировщик закрывает зависшую запись", () => {
  it("все площадки упали → запись получает «ошибка», публикацию не начинают", async () => {
    // @ts-ignore приватный метод
    const spy = vi.spyOn(scheduler as any, "publishToTelegramDirect");
    spy.mockResolvedValue({ platform: "telegram", success: true });

    vi.mocked(directusCrud.list).mockResolvedValue([
      {
        id: "stuck-1",
        status: "scheduled",
        user_id: "u-1",
        campaign_id: "camp-1",
        scheduled_at: "2025-05-30T13:39:00.000Z",
        social_platforms: {
          telegram: { status: "failed", error: "Forbidden: bots can\x27t send messages to bots" },
        },
      },
    ] as any);

    await scheduler.checkScheduledContent();

    expect(updatesFor("stuck-1")).toEqual([{ status: "error" }]);
    expect(spy).not.toHaveBeenCalled();
  });

  it("часть вышла, остальные упали → «опубликовано частично»", async () => {
    vi.mocked(directusCrud.list).mockResolvedValue([
      {
        id: "stuck-2",
        status: "partial",
        user_id: "u-1",
        campaign_id: "camp-1",
        social_platforms: {
          vk: { status: "published", postUrl: "https://vk.com/wall-1_1" },
          telegram: { status: "failed", error: "Bad Request: chat not found" },
        },
      },
    ] as any);

    await scheduler.checkScheduledContent();

    expect(updatesFor("stuck-2")).toEqual([{ status: "partially_published" }]);
  });

  it("живая площадка и давно прошедшее время → отправку отменяют, а не досылают", async () => {
    // @ts-ignore приватный метод
    const spy = vi.spyOn(scheduler as any, "publishToTelegramDirect");
    spy.mockResolvedValue({ platform: "telegram", success: true });

    vi.mocked(directusCrud.list).mockResolvedValue([
      {
        id: "stuck-3",
        status: "scheduled",
        user_id: "u-1",
        campaign_id: "camp-1",
        scheduled_at: "2025-10-24T16:50:00.000Z",
        social_platforms: { telegram: { status: "pending", selected: true } },
      },
    ] as any);

    await scheduler.checkScheduledContent();

    const [patch] = updatesFor("stuck-3");
    expect(patch.status).toBe("error");
    expect(patch.social_platforms.telegram.status).toBe("failed");
    expect(patch.social_platforms.telegram.errorCode).toBe("EXPIRED_UNPUBLISHED");
    // Самое главное: пост десятимесячной давности живым подписчикам НЕ ушёл.
    expect(spy).not.toHaveBeenCalled();
  });

  it("штатная запись со свежим временем не закрывается", async () => {
    const soon = new Date(Date.now() - 60 * 1000).toISOString();
    vi.mocked(directusCrud.list).mockResolvedValue([
      {
        id: "live-1",
        status: "scheduled",
        user_id: "u-1",
        campaign_id: "camp-1",
        scheduled_at: soon,
        social_platforms: { telegram: { status: "pending", scheduledAt: soon, selected: true } },
      },
    ] as any);
    // @ts-ignore приватный метод
    vi.spyOn(scheduler as any, "publishToTelegramDirect").mockResolvedValue({
      platform: "telegram",
      success: true,
    });

    await scheduler.checkScheduledContent();

    const closing = updatesFor("live-1").filter(
      (p) => p.status === "error" || p.status === "partially_published",
    );
    expect(closing).toEqual([]);
  });
});
