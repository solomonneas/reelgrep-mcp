import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type Database from "better-sqlite3";
import { ReelgrepClient } from "../../src/client.js";
import { registerSearchTools } from "../../src/tools/searches.js";
import { createCaptureServer } from "../_capture.js";
import { seededDb, VIDEO_A } from "../_seed.js";

let db: Database.Database;
let client: ReelgrepClient;

beforeEach(() => {
  db = seededDb();
  client = new ReelgrepClient(db);
});

afterEach(() => {
  client.close();
});

describe("reelgrep_list_searches", () => {
  it("returns all searches when unscoped", async () => {
    const server = createCaptureServer();
    registerSearchTools(server as never, client);
    const r = await server.invoke("reelgrep_list_searches", {});
    expect(r.isError).toBeUndefined();
    const body = JSON.parse(r.content[0].text);
    expect(body.count).toBe(2);
    expect(body.searches[0].match_count).toBeGreaterThan(0);
  });

  it("filters by file_hash", async () => {
    const server = createCaptureServer();
    registerSearchTools(server as never, client);
    const r = await server.invoke("reelgrep_list_searches", {
      file_hash: VIDEO_A.file_hash,
    });
    const body = JSON.parse(r.content[0].text);
    expect(body.count).toBe(1);
    expect(body.searches[0].label).toBe("Professor Smith");
    expect(body.searches[0].video_basename).toBe("Module_1-1.mp4");
    expect(body.searches[0].match_count).toBe(3);
  });
});

describe("reelgrep_get_search_matches", () => {
  it("returns search detail plus matches sorted by confidence desc", async () => {
    const server = createCaptureServer();
    registerSearchTools(server as never, client);
    const r = await server.invoke("reelgrep_get_search_matches", {
      search_id: 1,
    });
    expect(r.isError).toBeUndefined();
    const body = JSON.parse(r.content[0].text);
    expect(body.search.label).toBe("Professor Smith");
    expect(body.search.positive_examples).toEqual(["/refs/smith-1.jpg"]);
    expect(body.search.config).toEqual({ top_k: 10 });
    expect(body.matches.map((m: { confidence: number }) => m.confidence)).toEqual([
      0.95, 0.81, 0.74,
    ]);
    expect(body.matches[0].bbox).toEqual({ x: 12, y: 22, w: 48, h: 58 });
  });

  it("returns isError for unknown search id", async () => {
    const server = createCaptureServer();
    registerSearchTools(server as never, client);
    const r = await server.invoke("reelgrep_get_search_matches", {
      search_id: 999,
    });
    expect(r.isError).toBe(true);
    expect(JSON.parse(r.content[0].text).error).toContain("search not found");
  });
});
