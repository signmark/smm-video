/**
 * AI-85 — ПОВЕДЕНЧЕСКИЙ тест на главную причину дублей в канале клиента.
 *
 * Что было. Отправка поста и запись результата стояли в одном блоке обработки
 * ошибок. Пост уходил к подписчикам, запись в базу падала, ошибка записи
 * попадала в общий catch и трактовалась как ошибка ПУБЛИКАЦИИ — планировщик
 * назначал повтор и отправлял тот же пост второй раз. Так в канале `@mirgranita1`
 * появились пост 17 (31.07) и его дубль пост 18 (03.08).
 *
 * Что проверяется здесь: сбой записи после состоявшейся отправки больше не
 * выглядит как сбой публикации, факт уходит в журнал, и повторная отправка
 * того же материала не начинается.
 *
 * Мутации, которые обязаны красить:
 *   • вернуть `await save(...)` внутрь общего try — упадёт «повтор не назначен»;
 *   • убрать запись в журнал — упадут «факт запомнен» и «повтор не начнётся»;
 *   • убрать `forget` из догона — упадёт «после догона журнал пуст».
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";

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
vi.mock("../services/publishing-token", () => ({
  resolvePublishingToken: vi.fn().mockResolvedValue("service-token"),
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

const publishPost = vi.fn();
vi.mock("../services/social-platforms/telegram-service", () => ({
  telegramService: { publishPost: (...a: any[]) => publishPost(...a) },
}));

import axios from "axios";
import { getPublishScheduler } from "../services/publish-scheduler";
import { directusCrud } from "../services/directus-crud";
import { readJournal, wasPublished, recordPublished } from "../services/publish-fallback-journal";

const scheduler: any = getPublishScheduler();

const CONTENT = {
  id: "3577db8e-3b0e-44e5-8ef4-5b004e4cf61a",
  campaign_id: "e6063049-16de-482e-8e90-69a3e3d9b668",
  text_content: "Преобразите облик зданий с нашими фасадными изделиями",
  social_platforms: {},
};

let dir: string;

beforeEach(async () => {
  vi.clearAllMocks();
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "ai85-wiring-"));
  process.env.PUBLISH_JOURNAL_DIR = dir;
  process.env.DIRECTUS_URL = "http://directus.test";

  vi.mocked(axios.get).mockResolvedValue({
    data: { data: { social_media_settings: { telegram: { token: "t", chatId: "@ch" } } } },
  } as any);
  publishPost.mockResolvedValue({ success: true, messageId: 17, postUrl: "https://t.me/mirgranita1/17" });
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
  delete process.env.PUBLISH_JOURNAL_DIR;
});

describe("AI-85: сбой записи после состоявшейся публикации", () => {
  it("не назначает повтор и сообщает об успехе — пост ведь ушёл", async () => {
    const retrySpy = vi.spyOn(scheduler, "scheduleRetryOrFail").mockResolvedValue(undefined as any);
    const save = vi.fn().mockRejectedValue(new Error("connect ETIMEDOUT directus"));

    const result = await scheduler.publishToTelegramDirect(CONTENT, save);

    expect(publishPost).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ platform: "telegram", success: true });
    expect(retrySpy).not.toHaveBeenCalled();
  });

  it("запоминает факт публикации в журнале со ссылкой на пост", async () => {
    vi.spyOn(scheduler, "scheduleRetryOrFail").mockResolvedValue(undefined as any);
    const save = vi.fn().mockRejectedValue(new Error("connect ETIMEDOUT directus"));

    await scheduler.publishToTelegramDirect(CONTENT, save);

    const entry = await wasPublished(CONTENT.id, "telegram");
    expect(entry).not.toBeNull();
    expect(entry!.fields.postUrl).toBe("https://t.me/mirgranita1/17");
    expect(entry!.recordError).toContain("ETIMEDOUT");
  });

  it("при удачной записи журнал остаётся пустым", async () => {
    const save = vi.fn().mockResolvedValue(undefined);

    const result = await scheduler.publishToTelegramDirect(CONTENT, save);

    expect(result.success).toBe(true);
    expect(save).toHaveBeenCalledWith("telegram", expect.objectContaining({ status: "published" }));
    expect(await readJournal()).toEqual([]);
  });

  it("настоящая ошибка отправки по-прежнему ведёт к повтору", async () => {
    const retrySpy = vi.spyOn(scheduler, "scheduleRetryOrFail").mockResolvedValue(undefined as any);
    publishPost.mockResolvedValue({ success: false, error: "Bad Gateway" });
    const save = vi.fn().mockResolvedValue(undefined);

    const result = await scheduler.publishToTelegramDirect(CONTENT, save);

    expect(result.success).toBe(false);
    expect(retrySpy).toHaveBeenCalledTimes(1);
    expect(await readJournal()).toEqual([]);
  });
});

describe("AI-85: догон незаписанных публикаций", () => {
  it("дописывает запись в базу и очищает журнал", async () => {
    await recordPublished({
      contentId: CONTENT.id,
      platform: "telegram",
      fields: { status: "published", postId: "17", postUrl: "https://t.me/mirgranita1/17" },
      publishedAt: "2026-07-31T09:00:19.000Z",
      recordError: "connect ETIMEDOUT directus",
    });
    vi.mocked(directusCrud.list).mockResolvedValue([{ id: CONTENT.id, social_platforms: {} }] as any);
    vi.mocked(directusCrud.update).mockResolvedValue({} as any);

    const healed = await scheduler.reconcilePublishJournal();

    expect(healed).toBe(1);
    const written = vi.mocked(directusCrud.update).mock.calls.at(-1)?.[2] as any;
    expect(written.social_platforms.telegram).toMatchObject({
      status: "published",
      postUrl: "https://t.me/mirgranita1/17",
    });
    expect(await readJournal()).toEqual([]);
  });

  it("если база всё ещё недоступна — строка остаётся, факт не теряется", async () => {
    await recordPublished({
      contentId: CONTENT.id,
      platform: "telegram",
      fields: { status: "published", postUrl: "https://t.me/mirgranita1/17" },
      publishedAt: "2026-07-31T09:00:19.000Z",
      recordError: "connect ETIMEDOUT directus",
    });
    vi.mocked(directusCrud.list).mockRejectedValue(new Error("connect ETIMEDOUT directus"));

    const healed = await scheduler.reconcilePublishJournal();

    expect(healed).toBe(0);
    expect(await wasPublished(CONTENT.id, "telegram")).not.toBeNull();
  });

  it("удалённый материал не держит журнал вечно", async () => {
    await recordPublished({
      contentId: CONTENT.id, platform: "telegram", fields: {},
      publishedAt: "2026-07-31T09:00:19.000Z", recordError: "x",
    });
    vi.mocked(directusCrud.list).mockResolvedValue([] as any);

    const healed = await scheduler.reconcilePublishJournal();

    expect(healed).toBe(0);
    expect(await readJournal()).toEqual([]);
  });
});
