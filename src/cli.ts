import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { ReelgrepClient } from "./client.js";
import { getConfig } from "./config.js";
import { serve, VERSION } from "./index.js";
import { basename, formatMs } from "./tools/_util.js";
import type {
  CueWithVideo,
  ExportWithVideo,
  MatchWithFrame,
  SearchSummary,
  VideoSummary,
} from "./client.js";

export class UsageError extends Error {}

export type Parsed =
  | { kind: "help" }
  | { kind: "version" }
  | { kind: "mcp" }
  | { kind: "health"; json: boolean }
  | { kind: "videos-list"; json: boolean; limit: number; offset: number }
  | { kind: "videos-info"; json: boolean; fileHash: string }
  | {
      kind: "subtitles-search";
      json: boolean;
      query: string;
      fileHash: string | undefined;
      limit: number;
    }
  | {
      kind: "subtitles-cues";
      json: boolean;
      fileHash: string;
      timestampMs: number;
      windowSeconds: number;
    }
  | { kind: "quote-find"; json: boolean; query: string; limit: number }
  | { kind: "searches-list"; json: boolean; fileHash: string | undefined; limit: number }
  | { kind: "searches-matches"; json: boolean; searchId: number }
  | {
      kind: "exports-list";
      json: boolean;
      fileHash: string | undefined;
      kindFilter: string | undefined;
      limit: number;
    };

export const HELP = `reelgrep - browse and search a local reelgrep video index (read-only)

Usage:
  reelgrep <command> [subcommand] [options]

Commands:
  health                            Check the SQLite index is reachable (exit 1 if not ok)
  videos list                       List indexed videos, newest first
  videos info <file_hash>           Full metadata for one video (8+ hex prefix ok)
  subtitles search <query>          FTS5 search over subtitle cues
  subtitles cues <file_hash> <ms>   Cues within a window around a timestamp
  quote find <query>                Locate a quote and print paste-ready citations
  searches list                     List person/object searches
  searches matches <search_id>      One search with its matches, highest confidence first
  exports list                      List export artifacts (screenshots, clips, gifs, sheets)
  mcp                               Start the MCP server over stdio
  help                              Show this help

Global options:
  --json                            Emit raw JSON instead of human-readable text
  --version, -v                     Print version
  --help, -h                        Show help

videos list options:
  --limit <n>      Max videos, 1-100             (default 20)
  --offset <n>     Pagination offset             (default 0)

subtitles search options:
  --file-hash <h>  Restrict to one video
  --limit <n>      Max cues, 1-200               (default 25)

subtitles cues options:
  --window <s>     Half-width window seconds, 0-3600   (default 30)

quote find options:
  --limit <n>      Max citations, 1-50           (default 5)

searches list options:
  --file-hash <h>  Restrict to one video
  --limit <n>      Max searches, 1-100           (default 20)

exports list options:
  --file-hash <h>  Restrict to one video
  --kind <k>       screenshot | clip | gif | contact_sheet
  --limit <n>      Max exports, 1-200            (default 25)

Environment:
  REELGREP_DB_PATH   SQLite index path (default ~/.local/share/reelgrep/index.sqlite)`;

function ensureNoExtra(args: string[]): void {
  if (args.length) throw new UsageError(`Unexpected arguments: ${args.join(" ")}`);
}

function requireValue(v: string | undefined, name: string): string {
  if (v === undefined || v.startsWith("--")) throw new UsageError(`${name} requires a value`);
  return v;
}

function requireInt(v: string | undefined, name: string, min: number, max: number): number {
  const n = Number(requireValue(v, name));
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new UsageError(`${name} must be an integer in [${min}, ${max}]`);
  }
  return n;
}

function requireEnum<T extends string>(v: string | undefined, allowed: readonly T[], name: string): T {
  const s = requireValue(v, name);
  if (!(allowed as readonly string[]).includes(s)) {
    throw new UsageError(`${name} must be one of: ${allowed.join(", ")}`);
  }
  return s as T;
}

function parsePositiveIntArg(v: string, name: string): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) {
    throw new UsageError(`${name} must be a non-negative integer`);
  }
  return n;
}

function parseVideos(args: string[], json: boolean): Parsed {
  const sub = args.shift();
  if (sub === "list") {
    let limit = 20;
    let offset = 0;
    while (args.length) {
      const a = args.shift() as string;
      switch (a) {
        case "--limit":
          limit = requireInt(args.shift(), "--limit", 1, 100);
          break;
        case "--offset":
          offset = requireInt(args.shift(), "--offset", 0, 1_000_000);
          break;
        default:
          throw new UsageError(`Unexpected argument: ${a}`);
      }
    }
    return { kind: "videos-list", json, limit, offset };
  }
  if (sub === "info") {
    const fileHash = args.shift();
    if (!fileHash || fileHash.startsWith("--")) {
      throw new UsageError("videos info requires a <file_hash>");
    }
    ensureNoExtra(args);
    return { kind: "videos-info", json, fileHash };
  }
  throw new UsageError(`Unknown videos subcommand: ${sub ?? "(none)"} (expected list | info)`);
}

function parseSubtitles(args: string[], json: boolean): Parsed {
  const sub = args.shift();
  if (sub === "search") {
    let fileHash: string | undefined;
    let limit = 25;
    const positionals: string[] = [];
    while (args.length) {
      const a = args.shift() as string;
      switch (a) {
        case "--file-hash":
          fileHash = requireValue(args.shift(), "--file-hash");
          break;
        case "--limit":
          limit = requireInt(args.shift(), "--limit", 1, 200);
          break;
        default:
          if (a.startsWith("--")) throw new UsageError(`Unknown option: ${a}`);
          positionals.push(a);
      }
    }
    const query = positionals.join(" ").trim();
    if (!query) throw new UsageError("subtitles search requires a <query>");
    return { kind: "subtitles-search", json, query, fileHash, limit };
  }
  if (sub === "cues") {
    let windowSeconds = 30;
    const positionals: string[] = [];
    while (args.length) {
      const a = args.shift() as string;
      switch (a) {
        case "--window":
          windowSeconds = requireInt(args.shift(), "--window", 0, 3600);
          break;
        default:
          if (a.startsWith("--")) throw new UsageError(`Unknown option: ${a}`);
          positionals.push(a);
      }
    }
    if (positionals.length < 2) {
      throw new UsageError("subtitles cues requires <file_hash> <timestamp_ms>");
    }
    if (positionals.length > 2) {
      throw new UsageError(`Unexpected arguments: ${positionals.slice(2).join(" ")}`);
    }
    const fileHash = positionals[0];
    const timestampMs = parsePositiveIntArg(positionals[1], "<timestamp_ms>");
    return { kind: "subtitles-cues", json, fileHash, timestampMs, windowSeconds };
  }
  throw new UsageError(`Unknown subtitles subcommand: ${sub ?? "(none)"} (expected search | cues)`);
}

function parseQuote(args: string[], json: boolean): Parsed {
  const sub = args.shift();
  if (sub !== "find") {
    throw new UsageError(`Unknown quote subcommand: ${sub ?? "(none)"} (expected find)`);
  }
  let limit = 5;
  const positionals: string[] = [];
  while (args.length) {
    const a = args.shift() as string;
    switch (a) {
      case "--limit":
        limit = requireInt(args.shift(), "--limit", 1, 50);
        break;
      default:
        if (a.startsWith("--")) throw new UsageError(`Unknown option: ${a}`);
        positionals.push(a);
    }
  }
  const query = positionals.join(" ").trim();
  if (!query) throw new UsageError("quote find requires a <query>");
  return { kind: "quote-find", json, query, limit };
}

function parseSearches(args: string[], json: boolean): Parsed {
  const sub = args.shift();
  if (sub === "list") {
    let fileHash: string | undefined;
    let limit = 20;
    while (args.length) {
      const a = args.shift() as string;
      switch (a) {
        case "--file-hash":
          fileHash = requireValue(args.shift(), "--file-hash");
          break;
        case "--limit":
          limit = requireInt(args.shift(), "--limit", 1, 100);
          break;
        default:
          throw new UsageError(`Unexpected argument: ${a}`);
      }
    }
    return { kind: "searches-list", json, fileHash, limit };
  }
  if (sub === "matches") {
    const idArg = args.shift();
    if (!idArg || idArg.startsWith("--")) {
      throw new UsageError("searches matches requires a <search_id>");
    }
    const searchId = Number(idArg);
    if (!Number.isInteger(searchId) || searchId < 1) {
      throw new UsageError("<search_id> must be a positive integer");
    }
    ensureNoExtra(args);
    return { kind: "searches-matches", json, searchId };
  }
  throw new UsageError(`Unknown searches subcommand: ${sub ?? "(none)"} (expected list | matches)`);
}

const EXPORT_KINDS = ["screenshot", "clip", "gif", "contact_sheet"] as const;

function parseExports(args: string[], json: boolean): Parsed {
  const sub = args.shift();
  if (sub !== "list") {
    throw new UsageError(`Unknown exports subcommand: ${sub ?? "(none)"} (expected list)`);
  }
  let fileHash: string | undefined;
  let kindFilter: string | undefined;
  let limit = 25;
  while (args.length) {
    const a = args.shift() as string;
    switch (a) {
      case "--file-hash":
        fileHash = requireValue(args.shift(), "--file-hash");
        break;
      case "--kind":
        kindFilter = requireEnum(args.shift(), EXPORT_KINDS, "--kind");
        break;
      case "--limit":
        limit = requireInt(args.shift(), "--limit", 1, 200);
        break;
      default:
        throw new UsageError(`Unexpected argument: ${a}`);
    }
  }
  return { kind: "exports-list", json, fileHash, kindFilter, limit };
}

function takeFlag(args: string[], name: string): boolean {
  const i = args.indexOf(name);
  if (i === -1) return false;
  args.splice(i, 1);
  return true;
}

export function parseArgs(argv: string[]): Parsed {
  const args = [...argv];
  if (args.includes("-h") || args.includes("--help")) return { kind: "help" };
  if (args.includes("-v") || args.includes("--version")) return { kind: "version" };

  const cmd = args.shift();
  if (!cmd || cmd === "help") return { kind: "help" };

  const json = takeFlag(args, "--json");
  switch (cmd) {
    case "mcp":
      return { kind: "mcp" };
    case "health":
      ensureNoExtra(args);
      return { kind: "health", json };
    case "videos":
      return parseVideos(args, json);
    case "subtitles":
      return parseSubtitles(args, json);
    case "quote":
      return parseQuote(args, json);
    case "searches":
      return parseSearches(args, json);
    case "exports":
      return parseExports(args, json);
    default:
      throw new UsageError(`Unknown command: ${cmd}`);
  }
}

function safeParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

// -- renderers --------------------------------------------------------------

function renderVideosList(rows: VideoSummary[]): string {
  if (!rows.length) return "No videos indexed.";
  const lines = [`${rows.length} video(s):`];
  for (const v of rows) {
    const duration = v.duration_ms !== null ? formatMs(v.duration_ms) : "?";
    const res = v.width && v.height ? `${v.width}x${v.height}` : "?";
    lines.push("");
    lines.push(`${v.file_hash}  ${basename(v.path)}`);
    lines.push(
      `  ${duration}  ${res}  ${v.container ?? "?"}  ingested ${v.ingested_at}`,
    );
    lines.push(
      `  cues=${v.subtitle_cues_count} frames=${v.frames_count} searches=${v.person_searches_count} exports=${v.exports_count}`,
    );
  }
  return lines.join("\n");
}

function videosListPayload(rows: VideoSummary[]) {
  return {
    count: rows.length,
    videos: rows.map((v) => ({
      file_hash: v.file_hash,
      path: v.path,
      basename: basename(v.path),
      duration_ms: v.duration_ms,
      duration: v.duration_ms !== null ? formatMs(v.duration_ms) : null,
      resolution: v.width && v.height ? `${v.width}x${v.height}` : null,
      fps: v.fps,
      container: v.container,
      ingested_at: v.ingested_at,
      frames_count: v.frames_count,
      subtitle_cues_count: v.subtitle_cues_count,
      exports_count: v.exports_count,
      person_searches_count: v.person_searches_count,
    })),
  };
}

function videoInfoPayload(v: VideoSummary, exportsByKind: Record<string, number>) {
  return {
    file_hash: v.file_hash,
    path: v.path,
    basename: basename(v.path),
    duration_ms: v.duration_ms,
    duration: v.duration_ms !== null ? formatMs(v.duration_ms) : null,
    width: v.width,
    height: v.height,
    fps: v.fps,
    container: v.container,
    video_codec: v.video_codec,
    audio_codec: v.audio_codec,
    size_bytes: v.size_bytes,
    ingested_at: v.ingested_at,
    counts: {
      frames: v.frames_count,
      subtitle_cues: v.subtitle_cues_count,
      person_searches: v.person_searches_count,
      exports: v.exports_count,
      exports_by_kind: exportsByKind,
    },
  };
}

function renderVideoInfo(v: VideoSummary, exportsByKind: Record<string, number>): string {
  const lines = [
    `${v.file_hash}  ${basename(v.path)}`,
    `path: ${v.path}`,
    `duration: ${v.duration_ms !== null ? formatMs(v.duration_ms) : "?"}`,
    `resolution: ${v.width && v.height ? `${v.width}x${v.height}` : "?"}  fps: ${v.fps ?? "?"}`,
    `container: ${v.container ?? "?"}  video: ${v.video_codec ?? "?"}  audio: ${v.audio_codec ?? "?"}`,
    `size_bytes: ${v.size_bytes ?? "?"}`,
    `ingested_at: ${v.ingested_at}`,
    `counts: cues=${v.subtitle_cues_count} frames=${v.frames_count} searches=${v.person_searches_count} exports=${v.exports_count}`,
  ];
  const kinds = Object.entries(exportsByKind);
  if (kinds.length) {
    lines.push(`exports by kind: ${kinds.map(([k, n]) => `${k}=${n}`).join(" ")}`);
  }
  return lines.join("\n");
}

function cuePayload(c: CueWithVideo) {
  return {
    video_hash: c.video_hash,
    video_basename: basename(c.video_path),
    video_path: c.video_path,
    timecode: formatMs(c.start_ms),
    start_ms: c.start_ms,
    end_ms: c.end_ms,
    text: c.text,
    source: c.source,
    language: c.language,
    cue_id: c.id,
  };
}

function renderCues(cues: CueWithVideo[], emptyLabel: string): string {
  if (!cues.length) return emptyLabel;
  const lines = [`${cues.length} cue(s):`];
  for (const c of cues) {
    lines.push("");
    lines.push(`${formatMs(c.start_ms)}  ${basename(c.video_path)}  (${c.source}, cue ${c.id})`);
    lines.push(`  ${c.text}`);
  }
  return lines.join("\n");
}

function renderQuote(cues: CueWithVideo[]): string {
  if (!cues.length) return "No matches.";
  return cues
    .map((c) => {
      const sourceLabel =
        c.source === "whisper"
          ? "whisper-transcribed"
          : c.source === "sidecar"
            ? "sidecar"
            : c.source === "embedded"
              ? "embedded"
              : c.source;
      return [
        `From "${basename(c.video_path)}" at ${formatMs(c.start_ms)} (${sourceLabel}):`,
        `"${c.text}"`,
        `(cue id ${c.id}, hash ${c.video_hash})`,
      ].join("\n");
    })
    .join("\n\n");
}

function quotePayload(cues: CueWithVideo[]) {
  const results = cues.map(cuePayload);
  const formatted_citations = cues
    .map((c) => {
      const sourceLabel =
        c.source === "whisper"
          ? "whisper-transcribed"
          : c.source === "sidecar"
            ? "sidecar"
            : c.source === "embedded"
              ? "embedded"
              : c.source;
      return [
        `From "${basename(c.video_path)}" at ${formatMs(c.start_ms)} (${sourceLabel}):`,
        `"${c.text}"`,
        `(cue id ${c.id}, hash ${c.video_hash})`,
      ].join("\n");
    })
    .join("\n\n");
  return { count: results.length, results, formatted_citations };
}

function renderSearchesList(rows: SearchSummary[]): string {
  if (!rows.length) return "No person searches.";
  const lines = [`${rows.length} search(es):`];
  for (const s of rows) {
    lines.push(
      `  #${s.id}  "${s.label}"  ${basename(s.video_path)}  backend=${s.backend} threshold=${s.threshold} matches=${s.match_count}  ${s.created_at}`,
    );
  }
  return lines.join("\n");
}

function searchesListPayload(rows: SearchSummary[]) {
  return {
    count: rows.length,
    searches: rows.map((s) => ({
      id: s.id,
      video_hash: s.video_hash,
      video_basename: basename(s.video_path),
      label: s.label,
      backend: s.backend,
      threshold: s.threshold,
      created_at: s.created_at,
      match_count: s.match_count,
    })),
  };
}

function matchesPayload(search: SearchSummary, matches: MatchWithFrame[]) {
  return {
    search: {
      id: search.id,
      video_hash: search.video_hash,
      video_basename: basename(search.video_path),
      video_path: search.video_path,
      label: search.label,
      backend: search.backend,
      threshold: search.threshold,
      created_at: search.created_at,
      positive_examples: safeParseJson(search.positive_examples_json),
      negative_examples: safeParseJson(search.negative_examples_json),
      config: safeParseJson(search.config_json),
      match_count: search.match_count,
    },
    matches: matches.map((m) => ({
      id: m.id,
      frame_id: m.frame_id,
      confidence: m.confidence,
      timecode: formatMs(m.frame_timestamp_ms),
      frame_timestamp_ms: m.frame_timestamp_ms,
      frame_path: m.frame_path,
      bbox: m.bbox_json ? safeParseJson(m.bbox_json) : null,
      reasoning: m.reasoning,
    })),
  };
}

function renderMatches(search: SearchSummary, matches: MatchWithFrame[]): string {
  const lines = [
    `#${search.id}  "${search.label}"  ${basename(search.video_path)}`,
    `backend=${search.backend} threshold=${search.threshold} matches=${search.match_count}`,
  ];
  if (!matches.length) {
    lines.push("(no matches)");
    return lines.join("\n");
  }
  for (const m of matches) {
    lines.push("");
    lines.push(`  ${m.confidence.toFixed(2)}  ${formatMs(m.frame_timestamp_ms)}  frame ${m.frame_id}`);
    lines.push(`    ${m.frame_path}`);
    if (m.reasoning) lines.push(`    ${m.reasoning}`);
  }
  return lines.join("\n");
}

function renderExports(rows: ExportWithVideo[]): string {
  if (!rows.length) return "No exports.";
  const lines = [`${rows.length} export(s):`];
  for (const e of rows) {
    const range =
      e.start_ms !== null && e.end_ms !== null
        ? `${formatMs(e.start_ms)} - ${formatMs(e.end_ms)}`
        : e.start_ms !== null
          ? formatMs(e.start_ms)
          : "";
    lines.push(
      `  #${e.id}  [${e.kind}]  ${basename(e.path)}  ${basename(e.video_path)}${range ? `  ${range}` : ""}  ${e.created_at}`,
    );
  }
  return lines.join("\n");
}

function exportsPayload(rows: ExportWithVideo[]) {
  return {
    count: rows.length,
    exports: rows.map((e) => ({
      id: e.id,
      video_hash: e.video_hash,
      video_basename: basename(e.video_path),
      kind: e.kind,
      path: e.path,
      basename: basename(e.path),
      start_ms: e.start_ms,
      end_ms: e.end_ms,
      timecode_range:
        e.start_ms !== null && e.end_ms !== null
          ? `${formatMs(e.start_ms)} - ${formatMs(e.end_ms)}`
          : e.start_ms !== null
            ? formatMs(e.start_ms)
            : null,
      manifest_path: e.manifest_path,
      created_at: e.created_at,
    })),
  };
}

function healthPayload(client: ReelgrepClient) {
  const videoCount = client.videoCount();
  const sample = client.listVideos({ limit: 1, offset: 0 })[0]?.path ?? null;
  return {
    status: "ok" as const,
    version: VERSION,
    db_path: getConfig().dbPath,
    video_count: videoCount,
    sample,
  };
}

function renderHealth(h: ReturnType<typeof healthPayload>): string {
  const lines = [
    `status: ${h.status}`,
    `version: ${h.version}`,
    `db_path: ${h.db_path}`,
    `video_count: ${h.video_count}`,
  ];
  if (h.sample) lines.push(`sample: ${h.sample}`);
  return lines.join("\n");
}

export interface CliDeps {
  out: (s: string) => void;
  err: (s: string) => void;
  makeClient: () => ReelgrepClient;
  serve: () => Promise<void>;
}

export async function run(argv: string[], deps: CliDeps): Promise<number> {
  let parsed: Parsed;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    deps.err(error instanceof Error ? error.message : String(error));
    deps.err("");
    deps.err(HELP);
    return 2;
  }

  if (parsed.kind === "help") {
    deps.out(HELP);
    return 0;
  }
  if (parsed.kind === "version") {
    deps.out(VERSION);
    return 0;
  }
  if (parsed.kind === "mcp") {
    await deps.serve();
    return 0;
  }

  // Constructing the client opens the SQLite index; it throws when the index
  // is missing or unreadable. Surface that as a clean exit-1 runtime error.
  let client: ReelgrepClient;
  try {
    client = deps.makeClient();
  } catch (error) {
    deps.err(error instanceof Error ? error.message : String(error));
    return 1;
  }

  try {
    switch (parsed.kind) {
      case "health": {
        const h = healthPayload(client);
        deps.out(parsed.json ? JSON.stringify(h, null, 2) : renderHealth(h));
        return h.status === "ok" ? 0 : 1;
      }
      case "videos-list": {
        const rows = client.listVideos({ limit: parsed.limit, offset: parsed.offset });
        deps.out(parsed.json ? JSON.stringify(videosListPayload(rows), null, 2) : renderVideosList(rows));
        return 0;
      }
      case "videos-info": {
        const v = client.resolveVideoByHashOrPrefix(parsed.fileHash);
        if (!v) {
          deps.err(`video not found: ${parsed.fileHash}`);
          return 1;
        }
        const exportsByKind = client.exportsByKindForVideo(v.id);
        deps.out(
          parsed.json
            ? JSON.stringify(videoInfoPayload(v, exportsByKind), null, 2)
            : renderVideoInfo(v, exportsByKind),
        );
        return 0;
      }
      case "subtitles-search": {
        const cues = client.searchSubtitles({
          query: parsed.query,
          videoHash: parsed.fileHash,
          limit: parsed.limit,
        });
        deps.out(
          parsed.json
            ? JSON.stringify(
                {
                  query: parsed.query,
                  scoped_to: parsed.fileHash ?? null,
                  count: cues.length,
                  results: cues.map(cuePayload),
                },
                null,
                2,
              )
            : renderCues(cues, "No matches."),
        );
        return 0;
      }
      case "subtitles-cues": {
        const cues = client.recentCues({
          videoHash: parsed.fileHash,
          timestampMs: parsed.timestampMs,
          windowSeconds: parsed.windowSeconds,
        });
        deps.out(
          parsed.json
            ? JSON.stringify(
                {
                  file_hash: parsed.fileHash,
                  timestamp_ms: parsed.timestampMs,
                  window_seconds: parsed.windowSeconds,
                  count: cues.length,
                  cues: cues.map(cuePayload),
                },
                null,
                2,
              )
            : renderCues(cues, "No cues in the requested window."),
        );
        return 0;
      }
      case "quote-find": {
        const cues = client.searchSubtitles({ query: parsed.query, limit: parsed.limit });
        deps.out(parsed.json ? JSON.stringify(quotePayload(cues), null, 2) : renderQuote(cues));
        return 0;
      }
      case "searches-list": {
        const rows = client.listSearches({ videoHash: parsed.fileHash, limit: parsed.limit });
        deps.out(parsed.json ? JSON.stringify(searchesListPayload(rows), null, 2) : renderSearchesList(rows));
        return 0;
      }
      case "searches-matches": {
        const search = client.getSearch(parsed.searchId);
        if (!search) {
          deps.err(`search not found: ${parsed.searchId}`);
          return 1;
        }
        const matches = client.getMatches(parsed.searchId);
        deps.out(
          parsed.json
            ? JSON.stringify(matchesPayload(search, matches), null, 2)
            : renderMatches(search, matches),
        );
        return 0;
      }
      case "exports-list": {
        const rows = client.listExports({
          videoHash: parsed.fileHash,
          kind: parsed.kindFilter,
          limit: parsed.limit,
        });
        deps.out(parsed.json ? JSON.stringify(exportsPayload(rows), null, 2) : renderExports(rows));
        return 0;
      }
    }
  } catch (error) {
    deps.err(error instanceof Error ? error.message : String(error));
    return 1;
  }
  return 0;
}

// True when this module is the process entrypoint. process.argv[1] is often a
// symlink (npm installs the bin as a link); resolve it before comparing.
const isEntrypoint = (() => {
  const arg = process.argv[1];
  if (typeof arg !== "string") return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(arg)).href;
  } catch {
    return false;
  }
})();

if (isEntrypoint) {
  run(process.argv.slice(2), {
    out: (s) => process.stdout.write(`${s}\n`),
    err: (s) => process.stderr.write(`${s}\n`),
    makeClient: () => new ReelgrepClient(getConfig().dbPath),
    serve,
  })
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
