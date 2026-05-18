#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { getConfig } from "./config.js";

const VERSION = "0.1.0";

async function main(): Promise<void> {
  const config = getConfig();

  const server = new McpServer({
    name: "reelgrep-mcp",
    version: VERSION,
    description:
      "MCP server for reelgrep - browse and search a local video library from chat.",
  });

  server.tool(
    "reelgrep_health",
    "Report the reelgrep-mcp server status, version, and configured SQLite index path. Returns a placeholder video_count of 0 until the database is wired up in v0.2.",
    {},
    async () => {
      const payload = {
        status: "ok",
        version: VERSION,
        db_path: config.dbPath,
        video_count: 0,
      };
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(payload, null, 2),
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
