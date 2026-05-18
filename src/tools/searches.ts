import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ok, fail, formatMs, basename } from "./_util.js";
import type { ReelgrepClient } from "../client.js";

function safeParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/** Register the list_searches / get_search_matches read-only tools. */
export function registerSearchTools(
  server: McpServer,
  client: ReelgrepClient,
): void {
  server.tool(
    "reelgrep_list_searches",
    "List person/object searches that have been run against the library, newest first. Optionally scope to one video.",
    {
      file_hash: z
        .string()
        .optional()
        .describe("If provided, restrict to searches against this video."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe("Max searches to return (default 20, hard cap 100)."),
    },
    async ({ file_hash, limit }) => {
      try {
        const rows = client.listSearches({ videoHash: file_hash, limit });
        return ok({
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
        });
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.tool(
    "reelgrep_get_search_matches",
    "Fetch a single person/object search with its matches sorted by confidence (descending). Each match includes the matching frame's timestamp and path.",
    {
      search_id: z
        .number()
        .int()
        .min(1)
        .describe("Numeric search id, as returned by reelgrep_list_searches."),
    },
    async ({ search_id }) => {
      try {
        const search = client.getSearch(search_id);
        if (!search) return fail(new Error(`search not found: ${search_id}`));
        const matches = client.getMatches(search_id);
        return ok({
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
        });
      } catch (error) {
        return fail(error);
      }
    },
  );
}
