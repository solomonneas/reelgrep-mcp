import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ok, fail, formatMs, basename } from "./_util.js";
import type { ReelgrepClient } from "../client.js";

/** Register the list_videos / video_info read-only tools. */
export function registerVideoTools(
  server: McpServer,
  client: ReelgrepClient,
): void {
  server.tool(
    "reelgrep_list_videos",
    "List videos indexed by reelgrep, newest first. Includes per-video counts of subtitle cues, frames, person searches, and exports.",
    {
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe("Max videos to return (default 20, hard cap 100)."),
      offset: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Pagination offset, newest-first."),
    },
    async ({ limit, offset }) => {
      try {
        const rows = client.listVideos({ limit, offset });
        return ok({
          count: rows.length,
          videos: rows.map((v) => ({
            file_hash: v.file_hash,
            path: v.path,
            basename: basename(v.path),
            duration_ms: v.duration_ms,
            duration: v.duration_ms !== null ? formatMs(v.duration_ms) : null,
            resolution:
              v.width && v.height ? `${v.width}x${v.height}` : null,
            fps: v.fps,
            container: v.container,
            ingested_at: v.ingested_at,
            frames_count: v.frames_count,
            subtitle_cues_count: v.subtitle_cues_count,
            exports_count: v.exports_count,
            person_searches_count: v.person_searches_count,
          })),
        });
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.tool(
    "reelgrep_video_info",
    "Get full metadata for a single indexed video by file_hash (full or 8+ hex prefix).",
    {
      file_hash: z
        .string()
        .min(1)
        .describe(
          "Full file_hash (e.g. 'blake2b:8b63...') or an unambiguous 8+ hex-char prefix.",
        ),
    },
    async ({ file_hash }) => {
      try {
        const v = client.resolveVideoByHashOrPrefix(file_hash);
        if (!v) return fail(new Error(`video not found: ${file_hash}`));
        const exportsByKind = client.exportsByKindForVideo(v.id);
        return ok({
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
        });
      } catch (error) {
        return fail(error);
      }
    },
  );
}
