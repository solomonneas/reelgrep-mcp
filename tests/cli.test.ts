import { describe, expect, it, vi } from "vitest";
import { UsageError, parseArgs, run, type CliDeps } from "../src/cli.js";
import type { ReelgrepClient } from "../src/client.js";

function capture(
  client: Partial<ReelgrepClient>,
  serve = vi.fn().mockResolvedValue(undefined),
) {
  const out: string[] = [];
  const err: string[] = [];
  const deps: CliDeps = {
    out: (s) => out.push(s),
    err: (s) => err.push(s),
    makeClient: () => client as ReelgrepClient,
    serve,
  };
  return { out, err, deps, serve };
}

describe("parseArgs", () => {
  it("parses `videos list` with defaults and options", () => {
    expect(parseArgs(["videos", "list"])).toEqual({
      kind: "videos-list",
      json: false,
      limit: 20,
      offset: 0,
    });
    expect(parseArgs(["videos", "list", "--limit", "5", "--offset", "10", "--json"])).toEqual({
      kind: "videos-list",
      json: true,
      limit: 5,
      offset: 10,
    });
  });

  it("parses `videos info <file_hash>`", () => {
    expect(parseArgs(["videos", "info", "blake2b:8b63"])).toEqual({
      kind: "videos-info",
      json: false,
      fileHash: "blake2b:8b63",
    });
  });

  it("parses `subtitles search <query> [--limit]`", () => {
    expect(parseArgs(["subtitles", "search", "schema", "design"])).toEqual({
      kind: "subtitles-search",
      json: false,
      query: "schema design",
      fileHash: undefined,
      limit: 25,
    });
    expect(
      parseArgs(["subtitles", "search", "schema", "--limit", "3", "--file-hash", "abc12345", "--json"]),
    ).toEqual({
      kind: "subtitles-search",
      json: true,
      query: "schema",
      fileHash: "abc12345",
      limit: 3,
    });
  });

  it("parses `subtitles cues <file_hash> <timestamp_ms>`", () => {
    expect(parseArgs(["subtitles", "cues", "abc12345", "300000"])).toEqual({
      kind: "subtitles-cues",
      json: false,
      fileHash: "abc12345",
      timestampMs: 300000,
      windowSeconds: 30,
    });
    expect(parseArgs(["subtitles", "cues", "abc12345", "300000", "--window", "5"])).toEqual({
      kind: "subtitles-cues",
      json: false,
      fileHash: "abc12345",
      timestampMs: 300000,
      windowSeconds: 5,
    });
  });

  it("parses `quote find <query>`", () => {
    expect(parseArgs(["quote", "find", "database", "terminology", "--limit", "2"])).toEqual({
      kind: "quote-find",
      json: false,
      query: "database terminology",
      limit: 2,
    });
  });

  it("parses `searches list` and `searches matches <id>`", () => {
    expect(parseArgs(["searches", "list", "--file-hash", "abc12345"])).toEqual({
      kind: "searches-list",
      json: false,
      fileHash: "abc12345",
      limit: 20,
    });
    expect(parseArgs(["searches", "matches", "7"])).toEqual({
      kind: "searches-matches",
      json: false,
      searchId: 7,
    });
  });

  it("parses `exports list`", () => {
    expect(parseArgs(["exports", "list", "--kind", "clip", "--file-hash", "abc12345"])).toEqual({
      kind: "exports-list",
      json: false,
      fileHash: "abc12345",
      kindFilter: "clip",
      limit: 25,
    });
  });

  it("routes health, help and version", () => {
    expect(parseArgs(["health"])).toEqual({ kind: "health", json: false });
    expect(parseArgs(["health", "--json"])).toEqual({ kind: "health", json: true });
    expect(parseArgs(["mcp"])).toEqual({ kind: "mcp" });
    expect(parseArgs(["--version"])).toEqual({ kind: "version" });
    expect(parseArgs(["-v"])).toEqual({ kind: "version" });
    expect(parseArgs([])).toEqual({ kind: "help" });
    expect(parseArgs(["help"])).toEqual({ kind: "help" });
    expect(parseArgs(["--help"])).toEqual({ kind: "help" });
  });

  it("rejects bad input with UsageError", () => {
    expect(() => parseArgs(["bogus"])).toThrow(UsageError);
    expect(() => parseArgs(["videos", "bogus"])).toThrow(UsageError);
    expect(() => parseArgs(["videos", "info"])).toThrow(UsageError);
    expect(() => parseArgs(["subtitles", "search"])).toThrow(UsageError);
    expect(() => parseArgs(["subtitles", "cues", "abc12345"])).toThrow(UsageError);
    expect(() => parseArgs(["subtitles", "cues", "abc12345", "notnum"])).toThrow(UsageError);
    expect(() => parseArgs(["searches", "matches", "abc"])).toThrow(UsageError);
    expect(() => parseArgs(["videos", "list", "--limit", "9999"])).toThrow(UsageError);
    expect(() => parseArgs(["videos", "list", "extra"])).toThrow(UsageError);
    expect(() => parseArgs(["exports", "list", "--limit"])).toThrow(UsageError);
  });
});

describe("run", () => {
  it("prints human videos list output and exits 0", async () => {
    const client = {
      listVideos: vi.fn().mockReturnValue([
        {
          file_hash: "blake2b:c0ffee00",
          path: "/srv/lectures/Module_2-1.mp4",
          duration_ms: 987654,
          width: 1280,
          height: 720,
          fps: 24,
          container: "mp4",
          ingested_at: "2026-05-12T09:30:00Z",
          frames_count: 1,
          subtitle_cues_count: 2,
          exports_count: 2,
          person_searches_count: 1,
        },
      ]),
    };
    const { out, deps } = capture(client);
    const code = await run(["videos", "list", "--limit", "5"], deps);
    expect(code).toBe(0);
    expect(client.listVideos).toHaveBeenCalledWith({ limit: 5, offset: 0 });
    const text = out.join("\n");
    expect(text).toContain("Module_2-1.mp4");
    expect(text).toContain("blake2b:c0ffee00");
  });

  it("emits raw JSON with --json", async () => {
    const rows = [{ file_hash: "blake2b:c0ffee00", path: "/a.mp4" }];
    const client = { listVideos: vi.fn().mockReturnValue(rows) };
    const { out, deps } = capture(client);
    const code = await run(["videos", "list", "--json"], deps);
    expect(code).toBe(0);
    const parsed = JSON.parse(out.join("\n"));
    expect(parsed.count).toBe(1);
    expect(parsed.videos[0].file_hash).toBe("blake2b:c0ffee00");
  });

  it("videos info returns exit 1 when not found", async () => {
    const client = { resolveVideoByHashOrPrefix: vi.fn().mockReturnValue(null) };
    const { err, deps } = capture(client);
    const code = await run(["videos", "info", "deadbeef"], deps);
    expect(code).toBe(1);
    expect(err.join("\n")).toContain("video not found");
  });

  it("subtitles search prints hits and exits 0", async () => {
    const client = {
      searchSubtitles: vi.fn().mockReturnValue([
        {
          id: 2,
          video_id: 1,
          language: "en",
          source: "whisper",
          stream_index: null,
          start_ms: 320000,
          end_ms: 324000,
          text: "A schema describes the structure of the data.",
          video_hash: "blake2b:8b63a736",
          video_path: "/srv/lectures/Module_1-1.mp4",
        },
      ]),
    };
    const { out, deps } = capture(client);
    const code = await run(["subtitles", "search", "schema", "--limit", "3"], deps);
    expect(code).toBe(0);
    expect(client.searchSubtitles).toHaveBeenCalledWith({
      query: "schema",
      videoHash: undefined,
      limit: 3,
    });
    expect(out.join("\n")).toContain("A schema describes the structure of the data.");
  });

  it("subtitles cues calls recentCues", async () => {
    const client = { recentCues: vi.fn().mockReturnValue([]) };
    const { out, deps } = capture(client);
    const code = await run(["subtitles", "cues", "8b63a736", "320000", "--window", "5"], deps);
    expect(code).toBe(0);
    expect(client.recentCues).toHaveBeenCalledWith({
      videoHash: "8b63a736",
      timestampMs: 320000,
      windowSeconds: 5,
    });
    expect(out.join("\n")).toContain("No cues");
  });

  it("quote find prints citations", async () => {
    const client = {
      searchSubtitles: vi.fn().mockReturnValue([
        {
          id: 1,
          source: "whisper",
          start_ms: 311550,
          end_ms: 315000,
          text: "some more database terminology",
          video_hash: "blake2b:8b63a736",
          video_path: "/srv/lectures/Module_1-1.mp4",
          language: "en",
          stream_index: null,
          video_id: 1,
        },
      ]),
    };
    const { out, deps } = capture(client);
    const code = await run(["quote", "find", "database", "terminology"], deps);
    expect(code).toBe(0);
    expect(client.searchSubtitles).toHaveBeenCalledWith({
      query: "database terminology",
      limit: 5,
    });
    expect(out.join("\n")).toContain("Module_1-1.mp4");
  });

  it("searches matches returns exit 1 when search not found", async () => {
    const client = { getSearch: vi.fn().mockReturnValue(null) };
    const { err, deps } = capture(client);
    const code = await run(["searches", "matches", "99"], deps);
    expect(code).toBe(1);
    expect(err.join("\n")).toContain("search not found");
  });

  it("searches matches prints matches when found", async () => {
    const client = {
      getSearch: vi.fn().mockReturnValue({
        id: 1,
        video_hash: "blake2b:8b63a736",
        video_path: "/srv/lectures/Module_1-1.mp4",
        label: "Professor Smith",
        backend: "clip-vit-b32",
        threshold: 0.72,
        created_at: "2026-05-11T08:00:00Z",
        positive_examples_json: "[]",
        negative_examples_json: "[]",
        config_json: "{}",
        match_count: 1,
      }),
      getMatches: vi.fn().mockReturnValue([
        {
          id: 2,
          search_id: 1,
          frame_id: 2,
          confidence: 0.95,
          bbox_json: null,
          reasoning: "frontal view",
          frame_timestamp_ms: 200000,
          frame_path: "/srv/frames/a-200.jpg",
        },
      ]),
    };
    const { out, deps } = capture(client);
    const code = await run(["searches", "matches", "1"], deps);
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("Professor Smith");
    expect(out.join("\n")).toContain("0.95");
  });

  it("exports list prints rows", async () => {
    const client = {
      listExports: vi.fn().mockReturnValue([
        {
          id: 2,
          video_id: 1,
          kind: "clip",
          path: "/srv/exports/a-1.mp4",
          start_ms: 300000,
          end_ms: 360000,
          manifest_path: "/srv/exports/a-1.json",
          created_at: "2026-05-11T09:05:00Z",
          video_hash: "blake2b:8b63a736",
          video_path: "/srv/lectures/Module_1-1.mp4",
        },
      ]),
    };
    const { out, deps } = capture(client);
    const code = await run(["exports", "list", "--kind", "clip"], deps);
    expect(code).toBe(0);
    expect(client.listExports).toHaveBeenCalledWith({
      videoHash: undefined,
      kind: "clip",
      limit: 25,
    });
    expect(out.join("\n")).toContain("clip");
  });

  it("health prints ok and exits 0", async () => {
    const client = {
      videoCount: vi.fn().mockReturnValue(3),
      listVideos: vi.fn().mockReturnValue([{ path: "/srv/lectures/Module_1-1.mp4" }]),
    };
    const { out, deps } = capture(client);
    const code = await run(["health"], deps);
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("status: ok");
    expect(out.join("\n")).toContain("video_count: 3");
  });

  it("returns exit 1 when the client cannot be constructed (missing index)", async () => {
    const out: string[] = [];
    const err: string[] = [];
    const deps: CliDeps = {
      out: (s) => out.push(s),
      err: (s) => err.push(s),
      makeClient: () => {
        throw new Error("unable to open database file");
      },
      serve: vi.fn().mockResolvedValue(undefined),
    };
    const code = await run(["health"], deps);
    expect(code).toBe(1);
    expect(err.join("\n")).toContain("unable to open database file");
  });

  it("returns exit 1 and prints the error on client failure", async () => {
    const client = {
      listVideos: vi.fn().mockImplementation(() => {
        throw new Error("disk I/O error");
      }),
    };
    const { err, deps } = capture(client);
    expect(await run(["videos", "list"], deps)).toBe(1);
    expect(err.join("\n")).toContain("disk I/O error");
  });

  it("returns exit 2 and prints help on usage error", async () => {
    const { err, deps } = capture({});
    expect(await run(["bogus"], deps)).toBe(2);
    expect(err.join("\n")).toContain("Usage:");
  });

  it("prints version and help without constructing a client", async () => {
    const makeClient = vi.fn(() => {
      throw new Error("should not construct client");
    });
    const out: string[] = [];
    const deps: CliDeps = {
      out: (s) => out.push(s),
      err: () => {},
      makeClient,
      serve: vi.fn().mockResolvedValue(undefined),
    };
    expect(await run(["--version"], deps)).toBe(0);
    expect(await run(["help"], deps)).toBe(0);
    expect(makeClient).not.toHaveBeenCalled();
  });

  it("delegates `mcp` to serve()", async () => {
    const { deps, serve } = capture({});
    expect(await run(["mcp"], deps)).toBe(0);
    expect(serve).toHaveBeenCalledOnce();
  });
});
