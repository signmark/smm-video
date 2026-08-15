/**
 * Задача 108 — ПОВЕДЕНЧЕСКИЙ тест сходимости записи публикации.
 *
 * Проверяется РЕЗУЛЬТАТ решения: какой статус получит запись и какие площадки
 * будут закрыты, а не наличие строки в исходнике. Каждый случай списан с живых
 * данных прода на 15.08.2026 (срез перед правкой):
 *   — 22 записи «частично», где все площадки давно в терминале;
 *   — 3 записи «запланировано», где упали ВСЕ площадки (самая старая от 30.05.2025,
 *     Telegram ответил «бот не может писать другому боту»);
 *   — 1 запись «публикуется» с пустым списком площадок.
 *
 * Мутации, которые обязаны красить:
 *   вернуть «всё failed — оставляем текущий»  → падает случай про «запланировано»;
 *   считать терминальной любую площадку        → падает случай про живую площадку;
 *   закрывать по сроку без проверки живых      → падает счёт закрытых площадок;
 *   признать постоянной ошибку про лимит частоты → падает случай про временную причину.
 */
import { describe, it, expect } from "vitest";
import {
  resolveStuckContent,
  isPermanentPublishError,
  isPlatformTerminal,
  getStaleDays,
} from "../services/publication-terminal-state";

const NOW = new Date("2026-08-15T12:00:00.000Z");
const LONG_AGO = "2025-05-30T13:39:00.000Z";
const YESTERDAY = "2026-08-14T12:00:00.000Z";

function resolve(platforms: any, currentStatus: string, scheduledAt: string | null = null) {
  return resolveStuckContent({ platforms, currentStatus, scheduledAt, now: NOW, staleDays: 7 });
}

describe("Задача 108: запись обязана прийти к окончательному статусу", () => {
  it("упали ВСЕ площадки → запись становится «ошибка», а не висит «запланировано»", () => {
    const platforms = {
      telegram: { status: "failed", error: "Forbidden: bots can\x27t send messages to bots" },
    };
    const r = resolve(platforms, "scheduled", LONG_AGO);

    expect(r).not.toBeNull();
    expect(r!.contentStatus).toBe("error");
    expect(r!.reason).toBe("converged");
    // Ничего не закрывали по сроку — площадка и так была в терминале.
    expect(r!.expiredPlatforms).toEqual([]);
  });

  it("часть опубликована, остальные упали → «опубликовано частично»", () => {
    const platforms = {
      vk: { status: "published", postUrl: "https://vk.com/wall-1_1" },
      telegram: { status: "failed", error: "Bad Request: chat not found" },
      instagram: { status: "published", postUrl: "https://instagram.com/p/x" },
    };
    const r = resolve(platforms, "partial");

    expect(r!.contentStatus).toBe("partially_published");
    expect(r!.reason).toBe("converged");
  });

  it("осталась живая площадка и срок не вышел → не трогаем", () => {
    const platforms = {
      vk: { status: "published", postUrl: "https://vk.com/wall-1_1" },
      telegram: { status: "pending" },
    };
    expect(resolve(platforms, "partial", YESTERDAY)).toBeNull();
  });

  it("живая площадка, но время выхода прошло давно → отправка отменяется", () => {
    const platforms = {
      vk: { status: "published", postUrl: "https://vk.com/wall-1_1" },
      telegram: { status: "pending" },
      facebook: { status: "pending" },
    };
    const r = resolve(platforms, "partial", LONG_AGO);

    expect(r!.reason).toBe("expired");
    // Закрыты ровно живые — опубликованную не трогаем.
    expect(r!.expiredPlatforms.sort()).toEqual(["facebook", "telegram"]);
    expect(r!.platforms.vk.status).toBe("published");
    expect(r!.platforms.telegram.status).toBe("failed");
    expect(r!.platforms.telegram.errorCode).toBe("EXPIRED_UNPUBLISHED");
    // Причина написана для человека, а не кодом.
    expect(r!.platforms.telegram.error).toContain("время выхода прошло");
    // Часть всё же вышла — значит запись «опубликовано частично», а не «ошибка».
    expect(r!.contentStatus).toBe("partially_published");
  });

  it("ничего не вышло и срок истёк → «ошибка», все площадки закрыты", () => {
    const platforms = { telegram: { status: "pending" }, vk: { status: "pending" } };
    const r = resolve(platforms, "scheduled", LONG_AGO);

    expect(r!.contentStatus).toBe("error");
    expect(r!.expiredPlatforms.sort()).toEqual(["telegram", "vk"]);
  });

  it("пустой список площадок в рабочем статусе → «ошибка»", () => {
    const r = resolve({}, "publishing");
    expect(r!.contentStatus).toBe("error");
    expect(r!.reason).toBe("no-platforms");
  });

  it("«ожидает» без площадок и без даты остаётся планировщику — он вернёт его в черновик", () => {
    expect(resolve({}, "pending", null)).toBeNull();
  });

  it("запись уже в окончательном статусе не трогается", () => {
    const platforms = { telegram: { status: "failed", error: "chat not found" } };
    expect(resolve(platforms, "error")).toBeNull();
    expect(resolve(platforms, "published")).toBeNull();
    expect(resolve(platforms, "draft")).toBeNull();
  });

  it("статус уже совпадает с вычисленным → лишней записи в БД не будет", () => {
    // partially_published не входит в рабочие статусы: планировщик его не переписывает.
    const platforms = { vk: { status: "published", postUrl: "u" }, tg: { status: "failed" } };
    expect(resolve(platforms, "partially_published")).toBeNull();
  });

  it("пост ушёл на площадку, но не записался (SM-15) → считается опубликованным, не ретраится", () => {
    const platforms = { telegram: { status: "publish_succeeded_record_failed" } };
    const r = resolve(platforms, "scheduled");

    expect(r!.contentStatus).toBe("partially_published");
    expect(r!.expiredPlatforms).toEqual([]);
  });

  it("площадка с postUrl считается завершённой даже без статуса", () => {
    expect(isPlatformTerminal({ postUrl: "https://t.me/x/1" })).toBe(true);
    expect(isPlatformTerminal({ status: "pending" })).toBe(false);
    expect(isPlatformTerminal({ status: "pending", postUrl: "   " })).toBe(false);
    // Мусор вместо объекта не должен держать запись вечно.
    expect(isPlatformTerminal(null)).toBe(true);
    expect(isPlatformTerminal("сломано")).toBe(true);
  });
});

describe("Задача 108: постоянные причины отказа отличаются от временных", () => {
  it("постоянные — ретраить бессмысленно", () => {
    const permanent = [
      "{\"ok\":false,\"error_code\":400,\"description\":\"Bad Request: chat not found\"}",
      "Forbidden: bots can\x27t send messages to bots",
      "User authorization failed: invalid access_token (4).",
      "VK не настроен для кампании: отсутствует access_token.",
      "Контент не найден или отсутствует изображение",
      "Media type STORIES is not supported for this account",
      "bot was blocked by the user",
    ];
    for (const msg of permanent) {
      expect(isPermanentPublishError(msg), msg).toBe(true);
    }
  });

  it("временные — ради них ретраи и существуют", () => {
    const transient = [
      "Too Many Requests: retry after 30",
      "connect ETIMEDOUT 149.154.167.220:443",
      "socket hang up",
      "502 Bad Gateway",
      "Service Unavailable",
      "Request failed with status code 500: Internal Server Error",
    ];
    for (const msg of transient) {
      expect(isPermanentPublishError(msg), msg).toBe(false);
    }
  });

  it("пустая причина не считается постоянной — иначе потеряем законный ретрай", () => {
    expect(isPermanentPublishError("")).toBe(false);
    expect(isPermanentPublishError(null)).toBe(false);
    expect(isPermanentPublishError(undefined)).toBe(false);
  });

  it("временное сильнее постоянного, когда встречается вместе", () => {
    // Telegram отдаёт 429 с тем же кодом 400 в теле — это не повод хоронить пост.
    expect(isPermanentPublishError("Too Many Requests, chat not found later")).toBe(false);
  });
});

describe("Задача 108: порог давности берётся из настройки", () => {
  it("по умолчанию неделя", () => {
    expect(getStaleDays({} as NodeJS.ProcessEnv)).toBe(7);
  });

  it("настройка переопределяет", () => {
    expect(getStaleDays({ PUBLICATION_STALE_DAYS: "30" } as any)).toBe(30);
  });

  it("мусор и ноль не отключают защиту молча", () => {
    expect(getStaleDays({ PUBLICATION_STALE_DAYS: "0" } as any)).toBe(7);
    expect(getStaleDays({ PUBLICATION_STALE_DAYS: "-5" } as any)).toBe(7);
    expect(getStaleDays({ PUBLICATION_STALE_DAYS: "неделя" } as any)).toBe(7);
  });
});
