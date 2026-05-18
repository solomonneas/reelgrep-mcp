import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type Database from "better-sqlite3";
import { ReelgrepClient } from "../../src/client.js";
import { registerExportTools } from "../../src/tools/exports.js";
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

describe("reelgrep_list_exports", () => {
  it("lists all exports when unfiltered", async () => {
    const server = createCaptureServer();
    registerExportTools(server as never, client);
    const r = await server.invoke("reelgrep_list_exports", {});
    expect(r.isError).toBeUndefined();
    const body = JSON.parse(r.content[0].text);
    expect(body.count).toBe(5);
  });

  it("filters by kind", async () => {
    const server = createCaptureServer();
    registerExportTools(server as never, client);
    const r = await server.invoke("reelgrep_list_exports", { kind: "screenshot" });
    const body = JSON.parse(r.content[0].text);
    expect(body.count).toBe(2);
    expect(body.exports.every((e: { kind: string }) => e.kind === "screenshot")).toBe(true);
  });

  it("filters by file_hash", async () => {
    const server = createCaptureServer();
    registerExportTools(server as never, client);
    const r = await server.invoke("reelgrep_list_exports", {
      file_hash: VIDEO_A.file_hash,
    });
    const body = JSON.parse(r.content[0].text);
    expect(body.count).toBe(3);
    for (const e of body.exports as Array<{ video_hash: string }>) {
      expect(e.video_hash).toBe(VIDEO_A.file_hash);
    }
  });

  it("combines kind + file_hash filters and renders timecode_range", async () => {
    const server = createCaptureServer();
    registerExportTools(server as never, client);
    const r = await server.invoke("reelgrep_list_exports", {
      file_hash: VIDEO_A.file_hash,
      kind: "clip",
    });
    const body = JSON.parse(r.content[0].text);
    expect(body.count).toBe(1);
    expect(body.exports[0].timecode_range).toBe("00:05:00.000 - 00:06:00.000");
    expect(body.exports[0].basename).toBe("a-1.mp4");
  });

  it("renders timecode_range as null when both timestamps are null", async () => {
    const server = createCaptureServer();
    registerExportTools(server as never, client);
    const r = await server.invoke("reelgrep_list_exports", {
      file_hash: VIDEO_B.file_hash,
      kind: "contact_sheet",
    });
    const body = JSON.parse(r.content[0].text);
    expect(body.count).toBe(1);
    expect(body.exports[0].timecode_range).toBeNull();
    expect(body.exports[0].manifest_path).toBe("/srv/exports/b-sheet.json");
  });
});
