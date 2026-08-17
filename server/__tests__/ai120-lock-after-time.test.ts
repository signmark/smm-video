/**
 * AI-120 — планировщик не должен брать блокировку публикации для поста,
 * чьё время ещё не наступило.
 *
 * ДЕФЕКТ. Проверка времени стояла ПОСЛЕ уровня 4 (`acquireLock`). Поэтому на
 * каждом цикле для каждой будущей платформы планировщик делал полный круг:
 * поиск блокировки, создание записи блокировки, удаление записи. Три обращения
 * к Directus на платформу на цикл — впустую. Дублей это не давало (время всё
 * равно проверялось), но давало постоянный фон запросов, забивало лог строками
 * `publication-lock` и прятало настоящие конфликты блокировок среди служебных.
 *
 * ИСПРАВЛЕНИЕ. Решение о времени вынесено в чистую функцию `decidePublishTime`
 * и вызывается ДО уровней защиты. Не наступило время — `continue` без единого
 * обращения к базе.
 *
 * RED-BEFORE. На старом порядке падают: «будущий пост не трогает блокировку»
 * (acquireLock вызывался и тут же releaseLock), «смешанный список» и
 * «неразбираемое время» (старый код звал toISOString() на Invalid Date и ронял
 * весь цикл RangeError'ом).
 *
 * Чего тест НЕ проверяет: что публикация будущего поста не происходит — это
 * работало и раньше и закрыто другими тестами. Здесь важна цена холостого хода.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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
    isLocked: vi.fn().mockResolvedValue(false),
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

import {
  getPublishScheduler,
  decidePublishTime,
  formatPublishInstant,
} from "../services/publish-scheduler";
import { directusCrud } from "../services/directus-crud";
import { publicationLockManager } from "../services/publication-lock-manager";
import { publicationTracker } from "../services/publication-tracking";

const scheduler = getPublishScheduler();

const MINUTE = 60 * 1000;

/** Пост с одной площадкой Telegram и заданным временем публикации площадки. */
function post(id: string, platformScheduledAt: string | null) {
  return {
    id,
    status: "scheduled",
    user_id: "u-1",
    campaign_id: "camp-1",
    scheduled_at: platformScheduledAt,
    social_platforms: {
      telegram: { status: "pending", scheduledAt: platformScheduledAt },
    },
  };
}

/** Сколько раз планировщик брал блокировку для этой площадки. */
function acquiredFor(contentId: string): number {
  return vi
    .mocked(publicationLockManager.acquireLock)
    .mock.calls.filter((c) => c[0] === contentId).length;
}

let publishSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.DIRECTUS_URL = "http://directus.test";
  // @ts-ignore приватный кэш прошлых прогонов
  scheduler.processedContentCache.clear();
  // @ts-ignore планировщик мог остаться «занят» после упавшего теста
  scheduler.isProcessing = false;

  // Единственная точка, где публикация реально начинается.
  // @ts-ignore приватный метод
  publishSpy = vi.spyOn(scheduler as any, "publishContentToPlatforms");
  publishSpy.mockResolvedValue(undefined);
});

describe("AI-120: решение о времени — чистая функция", () => {
  const now = new Date("2026-08-17T12:00:00.000Z");

  it("время площадки в прошлом → пора", () => {
    const d = decidePublishTime({ scheduledAt: "2026-08-17T11:59:00.000Z" }, null, now);
    expect(d).toMatchObject({ due: true, source: "platform" });
  });

  it("время площадки в будущем → не пора", () => {
    const d = decidePublishTime({ scheduledAt: "2026-08-17T12:01:00.000Z" }, null, now);
    expect(d.due).toBe(false);
    expect(d.source).toBe("platform");
  });

  it("ровно текущий момент → пора (граница включительно, как было)", () => {
    expect(decidePublishTime({ scheduledAt: now.toISOString() }, null, now).due).toBe(true);
  });

  it("у площадки времени нет → берём общее время контента", () => {
    const d = decidePublishTime({}, "2026-08-17T11:00:00.000Z", now);
    expect(d).toMatchObject({ due: true, source: "content" });
    expect(decidePublishTime({}, "2026-08-17T13:00:00.000Z", now).due).toBe(false);
  });

  it("время площадки важнее общего времени контента", () => {
    // общее время давно прошло, но у площадки своё — будущее
    const d = decidePublishTime(
      { scheduledAt: "2026-08-17T18:00:00.000Z" },
      "2026-08-17T06:00:00.000Z",
      now,
    );
    expect(d).toMatchObject({ due: false, source: "platform" });
  });

  it("времени нет нигде → публикуем немедленно", () => {
    expect(decidePublishTime({}, null, now)).toMatchObject({ due: true, source: "immediate", at: null });
  });

  it("неразбираемое время → не пора (а не «пора немедленно»)", () => {
    expect(decidePublishTime({ scheduledAt: "не дата" }, null, now).due).toBe(false);
    expect(decidePublishTime({}, "не дата", now).due).toBe(false);
  });

  it("формат времени для лога не падает на неразобранной дате", () => {
    expect(() => formatPublishInstant(new Date(NaN))).not.toThrow();
    expect(formatPublishInstant(new Date(NaN))).toBe("не разобрано");
    expect(formatPublishInstant(null)).toBe("не задано");
    expect(formatPublishInstant(now)).toBe("2026-08-17T12:00:00.000Z");
  });
});

describe("AI-120: цикл планировщика не занимает блокировку раньше времени", () => {
  it("будущий пост → блокировка не берётся и база не опрашивается", async () => {
    const future = new Date(Date.now() + 60 * MINUTE).toISOString();
    vi.mocked(directusCrud.list).mockResolvedValue([post("future-1", future)] as any);

    await scheduler.checkScheduledContent();

    expect(acquiredFor("future-1")).toBe(0);
    expect(publicationLockManager.isLocked).not.toHaveBeenCalled();
    expect(publicationTracker.canPublish).not.toHaveBeenCalled();
    expect(publicationLockManager.releaseLock).not.toHaveBeenCalled();
    expect(publishSpy).not.toHaveBeenCalled();
  });

  it("десять циклов подряд по будущему посту → ни одной блокировки", async () => {
    const future = new Date(Date.now() + 60 * MINUTE).toISOString();
    vi.mocked(directusCrud.list).mockResolvedValue([post("future-2", future)] as any);

    for (let i = 0; i < 10; i++) {
      // @ts-ignore каждый цикл начинается «свободным», как в бою
      scheduler.isProcessing = false;
      await scheduler.checkScheduledContent();
    }

    expect(acquiredFor("future-2")).toBe(0);
    expect(publishSpy).not.toHaveBeenCalled();
  });

  it("наступившее время → блокировка берётся ровно один раз и публикация запускается", async () => {
    const past = new Date(Date.now() - MINUTE).toISOString();
    vi.mocked(directusCrud.list).mockResolvedValue([post("due-1", past)] as any);

    await scheduler.checkScheduledContent();

    expect(acquiredFor("due-1")).toBe(1);
    expect(publishSpy).toHaveBeenCalledTimes(1);
    expect(publishSpy.mock.calls[0][1]).toEqual(["telegram"]);
  });

  it("в списке и готовый, и будущий → блокировка только у готового", async () => {
    const past = new Date(Date.now() - MINUTE).toISOString();
    const future = new Date(Date.now() + 60 * MINUTE).toISOString();
    vi.mocked(directusCrud.list).mockResolvedValue([
      post("due-2", past),
      post("future-3", future),
    ] as any);

    await scheduler.checkScheduledContent();

    expect(acquiredFor("due-2")).toBe(1);
    expect(acquiredFor("future-3")).toBe(0);
    expect(publishSpy).toHaveBeenCalledTimes(1);
  });

  it("неразбираемое время площадки → цикл не падает, блокировки нет", async () => {
    vi.mocked(directusCrud.list).mockResolvedValue([post("broken-1", "31-02-2026 25:61")] as any);

    await expect(scheduler.checkScheduledContent()).resolves.not.toThrow();

    expect(acquiredFor("broken-1")).toBe(0);
    expect(publishSpy).not.toHaveBeenCalled();
  });
});

describe("AI-120: защита от дубля публикации сохранена", () => {
  it("два цикла подряд по одному готовому посту → публикация одна", async () => {
    const past = new Date(Date.now() - MINUTE).toISOString();
    vi.mocked(directusCrud.list).mockResolvedValue([post("due-3", past)] as any);

    await scheduler.checkScheduledContent();
    // @ts-ignore следующий цикл планировщика
    scheduler.isProcessing = false;
    await scheduler.checkScheduledContent();

    expect(publishSpy).toHaveBeenCalledTimes(1);
    expect(acquiredFor("due-3")).toBe(1);
  });

  it("два цикла одновременно → публикация одна", async () => {
    const past = new Date(Date.now() - MINUTE).toISOString();
    vi.mocked(directusCrud.list).mockResolvedValue([post("due-4", past)] as any);

    await Promise.all([scheduler.checkScheduledContent(), scheduler.checkScheduledContent()]);

    expect(publishSpy).toHaveBeenCalledTimes(1);
    expect(acquiredFor("due-4")).toBeLessThanOrEqual(1);
  });

  it("блокировку держит другой процесс → публикации нет", async () => {
    const past = new Date(Date.now() - MINUTE).toISOString();
    vi.mocked(directusCrud.list).mockResolvedValue([post("due-5", past)] as any);
    vi.mocked(publicationLockManager.acquireLock).mockResolvedValue(false);

    await scheduler.checkScheduledContent();

    expect(acquiredFor("due-5")).toBe(1);
    expect(publishSpy).not.toHaveBeenCalled();
  });
});

describe("AI-120: сторож порядка в исходнике", () => {
  const src = readFileSync(
    join(__dirname, "..", "services", "publish-scheduler.ts"),
    "utf8",
  );

  it("решение о времени принимается раньше захвата блокировки", () => {
    const timeIdx = src.indexOf("decidePublishTime(data,");
    const acquireIdx = src.indexOf("acquireLock(content.id");
    expect(timeIdx).toBeGreaterThan(0);
    expect(acquireIdx).toBeGreaterThan(0);
    expect(timeIdx).toBeLessThan(acquireIdx);
  });

  it("внутри цикла не осталось прежнего флага shouldPublish", () => {
    expect(src).not.toMatch(/let\s+shouldPublish\s*=/);
  });
});
