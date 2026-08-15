/**
 * AI-85 — журнал состоявшихся публикаций.
 *
 * Проверяется поведение, ради которого журнал заведён: он должен пережить
 * недоступность базы и ответить «этот материал на эту площадку уже уходил».
 * Мутация, которая обязана красить: сделать `wasPublished` всегда возвращающим
 * null — падает проверка про повтор; убрать `forget` — падает проверка про
 * очистку после догона.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";

vi.mock("../utils/logger");

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "ai85-journal-"));
  process.env.PUBLISH_JOURNAL_DIR = dir;
  vi.resetModules();
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
  delete process.env.PUBLISH_JOURNAL_DIR;
});

async function load() {
  return await import("../services/publish-fallback-journal");
}

describe("журнал публикаций, которые не удалось записать", () => {
  it("пустой журнал не знает ни о чём и не падает", async () => {
    const j = await load();
    expect(await j.readJournal()).toEqual([]);
    expect(await j.wasPublished("c1", "telegram")).toBeNull();
  });

  it("помнит состоявшуюся публикацию и отвечает на вопрос перед отправкой", async () => {
    const j = await load();
    const ok = await j.recordPublished({
      contentId: "c1",
      platform: "telegram",
      fields: { status: "published", postId: "17", postUrl: "https://t.me/ch/17" },
      publishedAt: "2026-07-31T09:00:19.000Z",
      recordError: "connect ETIMEDOUT directus",
    });

    expect(ok).toBe(true);
    const found = await j.wasPublished("c1", "telegram");
    expect(found).not.toBeNull();
    expect(found!.fields.postUrl).toBe("https://t.me/ch/17");
    expect(found!.publishedAt).toBe("2026-07-31T09:00:19.000Z");
  });

  it("различает площадки и материалы — чужая запись не блокирует публикацию", async () => {
    const j = await load();
    await j.recordPublished({
      contentId: "c1", platform: "telegram", fields: {},
      publishedAt: "2026-07-31T09:00:19.000Z", recordError: "x",
    });

    expect(await j.wasPublished("c1", "vk")).toBeNull();
    expect(await j.wasPublished("c2", "telegram")).toBeNull();
  });

  it("после догона записи строка исчезает и повтор снова разрешён", async () => {
    const j = await load();
    await j.recordPublished({
      contentId: "c1", platform: "telegram", fields: {},
      publishedAt: "2026-07-31T09:00:19.000Z", recordError: "x",
    });
    expect(await j.wasPublished("c1", "telegram")).not.toBeNull();

    await j.forget("c1", "telegram");

    expect(await j.wasPublished("c1", "telegram")).toBeNull();
    expect(await j.readJournal()).toEqual([]);
  });

  it("битая строка не мешает читать остальные", async () => {
    const j = await load();
    await j.recordPublished({
      contentId: "c1", platform: "telegram", fields: {},
      publishedAt: "2026-07-31T09:00:19.000Z", recordError: "x",
    });
    await fs.appendFile(path.join(dir, "published-not-recorded.jsonl"), "{это не json\n", "utf8");
    await j.recordPublished({
      contentId: "c2", platform: "vk", fields: {},
      publishedAt: "2026-08-01T09:00:19.000Z", recordError: "x",
    });

    const all = await j.readJournal();
    expect(all.map((e) => e.contentId)).toEqual(["c1", "c2"]);
  });
});
