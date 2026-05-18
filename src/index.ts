import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { getConfig } from "./config.js";
import { ReelgrepClient } from "./client.js";
import { registerVideoTools } from "./tools/videos.js";
import { registerSubtitleTools } from "./tools/subtitles.js";
import { registerSearchTools } from "./tools/searches.js";
import { registerExportTools } from "./tools/exports.js";

const VERSION = "0.1.0";

async function main(): Promise<void> {
  const config = getConfig();
  const client = new ReelgrepClient(config.dbPath);

  const server = new McpServer({
    name: "reelgrep-mcp",
    version: VERSION,
    description:
      "MCP server for reelgrep - browse and search a local video library (subtitles, frames, person searches, exports) from chat.",
  });

  registerVideoTools(server, client);
  registerSubtitleTools(server, client);
  registerSearchTools(server, client);
  registerExportTools(server, client);

  server.tool(
    "reelgrep_health",
    "Confirm the MCP server is reachable and report the configured SQLite index path plus the indexed video count.",
    {},
    async () => {
      const videoCount = client.videoCount();
      const sample = client.listVideos({ limit: 1, offset: 0 })[0]?.path ?? null;
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                status: "ok",
                version: VERSION,
                db_path: config.dbPath,
                video_count: videoCount,
                sample,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error: unknown) => {
  const msg = error instanceof Error ? error.message : String(error);
  console.error(`reelgrep-mcp fatal: ${msg}`);
  process.exit(1);
});
