import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ok, fail, formatMs, basename } from "./_util.js";
import type { ReelgrepClient } from "../client.js";

const EXPORT_KINDS = ["screenshot", "clip", "gif", "contact_sheet"] as const;

/** Register the list_exports read-only tool. */
export function registerExportTools(
  server: McpServer,
  client: ReelgrepClient,
): void {
  server.tool(
    "reelgrep_list_exports",
    "List export artifacts (screenshots, clips, gifs, contact sheets) that reelgrep has produced, newest first. Optionally filter by video and/or kind.",
    {
      file_hash: z
        .string()
        .optional()
        .describe("If provided, restrict to exports from this video."),
      kind: z
        .enum(EXPORT_KINDS)
        .optional()
        .describe("Filter by export kind."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(200)
        .optional()
        .describe("Max exports to return (default 25, hard cap 200)."),
    },
    async ({ file_hash, kind, limit }) => {
      try {
        const rows = client.listExports({
          videoHash: file_hash,
          kind,
          limit,
        });
        return ok({
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
        });
      } catch (error) {
        return fail(error);
      }
    },
  );
}
