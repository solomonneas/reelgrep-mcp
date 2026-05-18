import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ok, fail, formatMs, basename } from "./_util.js";
import type { CueWithVideo, ReelgrepClient } from "../client.js";

interface FlatHit {
  video_hash: string;
  video_basename: string;
  video_path: string;
  timecode: string;
  start_ms: number;
  end_ms: number;
  text: string;
  source: string;
  language: string | null;
  cue_id: number;
}

function toFlat(c: CueWithVideo): FlatHit {
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

/** Register the three subtitle/transcript read-only tools. */
export function registerSubtitleTools(
  server: McpServer,
  client: ReelgrepClient,
): void {
  server.tool(
    "reelgrep_search_subtitles",
    "Full-text search subtitle cues across the library (FTS5). Optionally scope to one video via file_hash. Returns hits both grouped by video and as a flat list.",
    {
      query: z
        .string()
        .min(1)
        .describe("FTS5 query string, e.g. 'database schema' or 'derived data'."),
      file_hash: z
        .string()
        .optional()
        .describe("If provided, restrict the search to this video only."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(200)
        .optional()
        .describe("Max cues to return (default 25, hard cap 200)."),
    },
    async ({ query, file_hash, limit }) => {
      try {
        const cues = client.searchSubtitles({
          query,
          videoHash: file_hash,
          limit,
        });
        const flat = cues.map(toFlat);
        const byVideo: Record<
          string,
          { video_basename: string; video_path: string; hits: FlatHit[] }
        > = {};
        for (const hit of flat) {
          if (!byVideo[hit.video_hash]) {
            byVideo[hit.video_hash] = {
              video_basename: hit.video_basename,
              video_path: hit.video_path,
              hits: [],
            };
          }
          byVideo[hit.video_hash].hits.push(hit);
        }
        return ok({
          query,
          scoped_to: file_hash ?? null,
          count: flat.length,
          by_video: byVideo,
          flat,
        });
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.tool(
    "reelgrep_recent_cues",
    "Return subtitle cues from a single video within a +/- window around a timestamp. Useful for getting context around a hit from reelgrep_search_subtitles.",
    {
      file_hash: z
        .string()
        .min(1)
        .describe("Video file_hash (full or 8+ hex prefix)."),
      timestamp_ms: z
        .number()
        .int()
        .min(0)
        .describe("Center of the window, in milliseconds from the start of the video."),
      window_seconds: z
        .number()
        .int()
        .min(0)
        .max(3600)
        .optional()
        .describe("Half-width of the window in seconds (default 30)."),
    },
    async ({ file_hash, timestamp_ms, window_seconds }) => {
      try {
        const cues = client.recentCues({
          videoHash: file_hash,
          timestampMs: timestamp_ms,
          windowSeconds: window_seconds,
        });
        return ok({
          file_hash,
          timestamp_ms,
          window_seconds: window_seconds ?? 30,
          count: cues.length,
          cues: cues.map(toFlat),
        });
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.tool(
    "reelgrep_find_quote",
    "Locate a quote across the indexed library and return both structured JSON and a human-readable citations block ready to paste.",
    {
      query: z
        .string()
        .min(1)
        .describe("FTS5 query for the quote, e.g. \"some more database terminology\"."),
      max_results: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .describe("Max citations to return (default 5)."),
    },
    async ({ query, max_results }) => {
      try {
        const cues = client.searchSubtitles({
          query,
          limit: max_results ?? 5,
        });
        const results = cues.map(toFlat);
        const formatted_citations = results
          .map((r) => {
            const sourceLabel =
              r.source === "whisper"
                ? "whisper-transcribed"
                : r.source === "sidecar"
                  ? "sidecar"
                  : r.source === "embedded"
                    ? "embedded"
                    : r.source;
            return [
              `From "${r.video_basename}" at ${r.timecode} (${sourceLabel}):`,
              `"${r.text}"`,
              `(cue id ${r.cue_id}, hash ${r.video_hash})`,
            ].join("\n");
          })
          .join("\n\n");
        return ok({
          query,
          count: results.length,
          results,
          formatted_citations,
        });
      } catch (error) {
        return fail(error);
      }
    },
  );
}
