import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type Database from "better-sqlite3";
import { ReelgrepClient } from "../../src/client.js";
import { registerVideoTools } from "../../src/tools/videos.js";
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

describe("reelgrep_list_videos", () => {
  it("returns videos newest-first with derived fields and counts", async () => {
    const server = createCaptureServer();
    registerVideoTools(server as never, client);

    const r = await server.invoke("reelgrep_list_videos", {});
    expect(r.isError).toBeUndefined();
    const body = JSON.parse(r.content[0].text);
    expect(body.count).toBe(2);
    expect(body.videos[0].file_hash).toBe(VIDEO_B.file_hash);
    expect(body.videos[0].basename).toBe("Module_2-1.mp4");
    expect(body.videos[0].resolution).toBe("1280x720");
    expect(body.videos[1].duration).toBe("00:20:34.567");
    expect(body.videos[1].subtitle_cues_count).toBe(3);
  });

  it("honors limit", async () => {
    const server = createCaptureServer();
    registerVideoTools(server as never, client);
    const r = await server.invoke("reelgrep_list_videos", { limit: 1 });
    const body = JSON.parse(r.content[0].text);
    expect(body.count).toBe(1);
  });
});

describe("reelgrep_video_info", () => {
  it("returns full metadata for a full-hash lookup", async () => {
    const server = createCaptureServer();
    registerVideoTools(server as never, client);
    const r = await server.invoke("reelgrep_video_info", {
      file_hash: VIDEO_A.file_hash,
    });
    expect(r.isError).toBeUndefined();
    const body = JSON.parse(r.content[0].text);
    expect(body.file_hash).toBe(VIDEO_A.file_hash);
    expect(body.basename).toBe("Module_1-1.mp4");
    expect(body.counts.subtitle_cues).toBe(3);
    expect(body.counts.exports_by_kind).toEqual({
      screenshot: 1,
      clip: 1,
      gif: 1,
    });
  });

  it("resolves an 8-char hex prefix", async () => {
    const server = createCaptureServer();
    registerVideoTools(server as never, client);
    const prefix = VIDEO_A.file_hash.replace(/^blake2b:/, "").slice(0, 8);
    const r = await server.invoke("reelgrep_video_info", { file_hash: prefix });
    expect(r.isError).toBeUndefined();
    expect(JSON.parse(r.content[0].text).file_hash).toBe(VIDEO_A.file_hash);
  });

  it("returns isError for an unknown hash", async () => {
    const server = createCaptureServer();
    registerVideoTools(server as never, client);
    const r = await server.invoke("reelgrep_video_info", {
      file_hash: "blake2b:ffffffff",
    });
    expect(r.isError).toBe(true);
    expect(JSON.parse(r.content[0].text).error).toContain("video not found");
  });
});
