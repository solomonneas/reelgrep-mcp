import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { getConfig } from "./config.js";
import { ReelgrepClient } from "./client.js";
import { registerVideoTools } from "./tools/videos.js";
import { registerSubtitleTools } from "./tools/subtitles.js";
import { registerSearchTools } from "./tools/searches.js";
import { registerExportTools } from "./tools/exports.js";
import pkg from "../package.json" with { type: "json" };

export const VERSION = pkg.version;

export function createServer(): McpServer {
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

  return server;
}

// Strip the draft-07 `$schema` the MCP SDK stamps on tool schemas; Anthropic
// rejects it ("must match JSON Schema draft 2020-12") when the full tool set
// is sent, e.g. on subagent spawns. Used to intercept tools/list output.
export function stripDraftSchema(message: any): void {
  const tools = message?.result?.tools;
  if (Array.isArray(tools)) {
    for (const t of tools) {
      if (t?.inputSchema) delete t.inputSchema.$schema;
      if (t?.outputSchema) delete t.outputSchema.$schema;
    }
  }
}

export function applySchemaStripIntercept(transport: { send: (message: any, ...rest: any[]) => unknown }): void {
  const __send = transport.send.bind(transport);
  (transport as any).send = (message: any, ...rest: any[]) => {
    stripDraftSchema(message);
    return __send(message, ...rest);
  };
}

export async function serve(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  applySchemaStripIntercept(transport);
  await server.connect(transport);
}
