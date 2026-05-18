import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type Database from "better-sqlite3";
import { ReelgrepClient } from "../../src/client.js";
import { registerSubtitleTools } from "../../src/tools/subtitles.js";
import { createCaptureServer } from "../_capture.js";
import { seededDb, VIDEO_A, VIDEO_B } from "../_seed.js";

let db: Database.Database;
let client: ReelgrepClient;

beforeEach(() => {
  db = seededDb();
  client = new ReelgrepClient(db);
});

afterEach(() => {
  client.close();
});

describe("reelgrep_search_subtitles", () => {
  it("returns hits grouped by video AND flat across the library", async () => {
    const server = createCaptureServer();
    registerSubtitleTools(server as never, client);
    const r = await server.invoke("reelgrep_search_subtitles", {
      query: "schema",
    });
    expect(r.isError).toBeUndefined();
    const body = JSON.parse(r.content[0].text);
    expect(body.count).toBeGreaterThan(0);
    expect(body.scoped_to).toBeNull();
    expect(Array.isArray(body.flat)).toBe(true);
    expect(body.by_video).toHaveProperty(VIDEO_A.file_hash);
    expect(body.by_video).toHaveProperty(VIDEO_B.file_hash);
    expect(body.by_video[VIDEO_A.file_hash].video_basename).toBe("Module_1-1.mp4");
  });

  it("restricts results when scoped to a single video", async () => {
    const server = createCaptureServer();
    registerSubtitleTools(server as never, client);
    const r = await server.invoke("reelgrep_search_subtitles", {
      query: "schema",
      file_hash: VIDEO_A.file_hash,
    });
    const body = JSON.parse(r.content[0].text);
    expect(body.scoped_to).toBe(VIDEO_A.file_hash);
    expect(Object.keys(body.by_video)).toEqual([VIDEO_A.file_hash]);
  });

  it("returns count=0 when no cues match", async () => {
    const server = createCaptureServer();
    registerSubtitleTools(server as never, client);
    const r = await server.invoke("reelgrep_search_subtitles", {
      query: "neverappears",
    });
    const body = JSON.parse(r.content[0].text);
    expect(body.count).toBe(0);
    expect(body.flat).toEqual([]);
    expect(body.by_video).toEqual({});
  });
});

describe("reelgrep_recent_cues", () => {
  it("returns cues within a +/- window, sorted by start_ms", async () => {
    const server = createCaptureServer();
    registerSubtitleTools(server as never, client);
    const r = await server.invoke("reelgrep_recent_cues", {
      file_hash: VIDEO_A.file_hash,
      timestamp_ms: 320_000,
      window_seconds: 15,
    });
    expect(r.isError).toBeUndefined();
    const body = JSON.parse(r.content[0].text);
    expect(body.count).toBeGreaterThan(0);
    const starts: number[] = body.cues.map((c: { start_ms: number }) => c.start_ms);
    const sorted = [...starts].sort((a, b) => a - b);
    expect(starts).toEqual(sorted);
  });

  it("returns count=0 for an empty window", async () => {
    const server = createCaptureServer();
    registerSubtitleTools(server as never, client);
    const r = await server.invoke("reelgrep_recent_cues", {
      file_hash: VIDEO_A.file_hash,
      timestamp_ms: 0,
      window_seconds: 1,
    });
    const body = JSON.parse(r.content[0].text);
    expect(body.count).toBe(0);
    expect(body.cues).toEqual([]);
  });
});

describe("reelgrep_find_quote", () => {
  it("returns both structured results and a formatted citation block", async () => {
    const server = createCaptureServer();
    registerSubtitleTools(server as never, client);
    const r = await server.invoke("reelgrep_find_quote", {
      query: '"some more database terminology"',
    });
    expect(r.isError).toBeUndefined();
    const body = JSON.parse(r.content[0].text);
    expect(body.count).toBeGreaterThan(0);
    expect(typeof body.formatted_citations).toBe("string");

    const expected = [
      'From "Module_1-1.mp4" at 00:05:11.550 (whisper-transcribed):',
      `"So, now let's take a look at some more database terminology, schema, instances, and state."`,
      `(cue id 1, hash ${VIDEO_A.file_hash})`,
    ].join("\n");
    expect(body.formatted_citations).toContain(expected);
  });

  it("returns count=0 with empty formatted_citations when nothing matches", async () => {
    const server = createCaptureServer();
    registerSubtitleTools(server as never, client);
    const r = await server.invoke("reelgrep_find_quote", {
      query: "neverappears",
    });
    const body = JSON.parse(r.content[0].text);
    expect(body.count).toBe(0);
    expect(body.formatted_citations).toBe("");
  });
});
