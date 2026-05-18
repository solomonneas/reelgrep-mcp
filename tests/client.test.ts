import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type Database from "better-sqlite3";
import { ReelgrepClient } from "../src/client.js";
import { seededDb, VIDEO_A, VIDEO_B } from "./_seed.js";

let db: Database.Database;
let client: ReelgrepClient;

beforeEach(() => {
  db = seededDb();
  client = new ReelgrepClient(db);
});

afterEach(() => {
  client.close();
});

describe("ReelgrepClient.videoCount", () => {
  it("returns the total number of videos", () => {
    expect(client.videoCount()).toBe(2);
  });
});

describe("ReelgrepClient.listVideos", () => {
  it("returns videos newest-first with related counts", () => {
    const rows = client.listVideos();
    expect(rows).toHaveLength(2);
    expect(rows[0].file_hash).toBe(VIDEO_B.file_hash);
    expect(rows[1].file_hash).toBe(VIDEO_A.file_hash);
    expect(rows[1].subtitle_cues_count).toBe(3);
    expect(rows[1].frames_count).toBe(3);
    expect(rows[1].exports_count).toBe(3);
    expect(rows[1].person_searches_count).toBe(1);
  });

  it("honors limit and offset", () => {
    const first = client.listVideos({ limit: 1, offset: 0 });
    const second = client.listVideos({ limit: 1, offset: 1 });
    expect(first[0].file_hash).toBe(VIDEO_B.file_hash);
    expect(second[0].file_hash).toBe(VIDEO_A.file_hash);
  });

  it("caps limit at 100", () => {
    const rows = client.listVideos({ limit: 9999 });
    expect(rows).toHaveLength(2);
  });
});

describe("ReelgrepClient.resolveVideoByHashOrPrefix", () => {
  it("returns a video by full hash", () => {
    const v = client.resolveVideoByHashOrPrefix(VIDEO_A.file_hash);
    expect(v?.file_hash).toBe(VIDEO_A.file_hash);
  });

  it("returns a video by 8-char hex prefix", () => {
    const prefix = VIDEO_A.file_hash.replace(/^blake2b:/, "").slice(0, 8);
    const v = client.resolveVideoByHashOrPrefix(prefix);
    expect(v?.file_hash).toBe(VIDEO_A.file_hash);
  });

  it("accepts a prefix that includes the blake2b: scheme", () => {
    const prefix = VIDEO_A.file_hash.slice(0, "blake2b:".length + 10);
    const v = client.resolveVideoByHashOrPrefix(prefix);
    expect(v?.file_hash).toBe(VIDEO_A.file_hash);
  });

  it("returns null for unknown hash", () => {
    expect(client.resolveVideoByHashOrPrefix("blake2b:ffffffff")).toBeNull();
  });

  it("returns null for ambiguous prefixes when nothing matches", () => {
    expect(client.resolveVideoByHashOrPrefix("not-hex")).toBeNull();
  });
});

describe("ReelgrepClient.searchSubtitles", () => {
  it("returns matches across both videos when unscoped", () => {
    const hits = client.searchSubtitles({ query: "schema" });
    const videoHashes = new Set(hits.map((h) => h.video_hash));
    expect(videoHashes.has(VIDEO_A.file_hash)).toBe(true);
    expect(videoHashes.has(VIDEO_B.file_hash)).toBe(true);
  });

  it("restricts results when scoped to a single video", () => {
    const hits = client.searchSubtitles({
      query: "schema",
      videoHash: VIDEO_A.file_hash,
    });
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) expect(h.video_hash).toBe(VIDEO_A.file_hash);
  });

  it("returns empty array when video is unknown", () => {
    const hits = client.searchSubtitles({
      query: "schema",
      videoHash: "blake2b:00000000",
    });
    expect(hits).toEqual([]);
  });

  it("returns empty array when the query has no hits", () => {
    expect(client.searchSubtitles({ query: "neverappears" })).toEqual([]);
  });
});

describe("ReelgrepClient.recentCues", () => {
  it("returns cues within the window", () => {
    const cues = client.recentCues({
      videoHash: VIDEO_A.file_hash,
      timestampMs: 320_000,
      windowSeconds: 15,
    });
    expect(cues.length).toBeGreaterThan(0);
    expect(cues.every((c) => c.start_ms >= 305_000 && c.start_ms <= 335_000)).toBe(true);
  });

  it("returns empty array for an empty window", () => {
    const cues = client.recentCues({
      videoHash: VIDEO_A.file_hash,
      timestampMs: 0,
      windowSeconds: 1,
    });
    expect(cues).toEqual([]);
  });
});

describe("ReelgrepClient.listSearches / getSearch / getMatches", () => {
  it("lists all searches when unscoped", () => {
    const rows = client.listSearches();
    expect(rows).toHaveLength(2);
    expect(rows[0].created_at >= rows[1].created_at).toBe(true);
  });

  it("scopes searches to a single video", () => {
    const rows = client.listSearches({ videoHash: VIDEO_A.file_hash });
    expect(rows).toHaveLength(1);
    expect(rows[0].label).toBe("Professor Smith");
    expect(rows[0].match_count).toBe(3);
  });

  it("fetches a single search and its matches sorted by confidence desc", () => {
    const search = client.getSearch(1);
    expect(search?.label).toBe("Professor Smith");
    const matches = client.getMatches(1);
    expect(matches.map((m) => m.confidence)).toEqual([0.95, 0.81, 0.74]);
    expect(matches[0].frame_path).toBe("/srv/frames/a-200.jpg");
  });

  it("returns null for unknown search id", () => {
    expect(client.getSearch(999)).toBeNull();
  });
});

describe("ReelgrepClient.listExports / exportsByKindForVideo", () => {
  it("lists exports filtered by file_hash", () => {
    const rows = client.listExports({ videoHash: VIDEO_A.file_hash });
    expect(rows).toHaveLength(3);
    for (const r of rows) expect(r.video_hash).toBe(VIDEO_A.file_hash);
  });

  it("lists exports filtered by kind", () => {
    const rows = client.listExports({ kind: "screenshot" });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.kind === "screenshot")).toBe(true);
  });

  it("combines file_hash + kind filters", () => {
    const rows = client.listExports({
      videoHash: VIDEO_B.file_hash,
      kind: "contact_sheet",
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].manifest_path).toBe("/srv/exports/b-sheet.json");
  });

  it("returns kind counts for a single video", () => {
    expect(client.exportsByKindForVideo(VIDEO_A.id)).toEqual({
      screenshot: 1,
      clip: 1,
      gif: 1,
    });
  });
});
