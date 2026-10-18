import { randomUUID } from "node:crypto";
import { request } from "node:http";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createHttpServer, type HttpServerHandle } from "../src/http.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { seededDb } from "./_seed.js";

const TOKEN = randomUUID();
const directory = mkdtempSync(join(tmpdir(), "reelgrep-http-"));
const dbPath = join(directory, "index.sqlite");
const seed = seededDb();
await seed.backup(dbPath);
seed.close();
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.close();
const env = {
  REELGREP_DB_PATH: dbPath,
  REELGREP_MCP_HTTP_TOKEN: TOKEN,
  REELGREP_MCP_HTTP_PORT: "0",
  REELGREP_MCP_HTTP_HOST: undefined,
  REELGREP_MCP_HTTP_LOCAL_FILES: "true",
};
let http: HttpServerHandle | undefined;
afterAll(() => rmSync(directory, { recursive: true, force: true }));
const connections: { client: Client; transport: StreamableHTTPClientTransport }[] = [];
afterEach(async () => {
  for (const { client, transport } of connections.splice(0)) {
    await transport.terminateSession().catch(() => undefined);
    await client.close();
  }
  await http?.close();
  http = undefined;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function configure(extra = {}) {
  for (const [name, value] of Object.entries({ ...env, ...extra })) vi.stubEnv(name, value);
}
async function start(extra = {}) {
  configure(extra);
  http = await createHttpServer();
  return `http://localhost:${http.port}`;
}
async function connect(url: string) {
  const transport = new StreamableHTTPClientTransport(new URL(`${url}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
  });
  const client = new Client({ name: "http-test", version: "1" });
  connections.push({ client, transport });
  await client.connect(transport);
  return { client, transport };
}

describe("authenticated Streamable HTTP", () => {
  it.each([undefined, "Bearer wrong-token"])("rejects invalid authentication: %s", async (authorization) => {
    const url = await start();
    const response = await fetch(`${url}/mcp`, { method: "POST", headers: authorization ? { authorization } : {} });
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe("Bearer");
    expect(await response.text()).toBe("Unauthorized");
  });

  it("exposes only liveness without authentication", async () => {
    const response = await fetch(`${await start()}/healthz`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("lists tools using the SDK client and terminates its session", async () => {
    const url = await start();
    const { client, transport } = await connect(url);
    const result = await client.listTools();
    expect(result.tools).toHaveLength(9);
    expect(result.tools.some((t) => t.name === "reelgrep_health")).toBe(true);
    const id = transport.sessionId;
    expect(id).toBeTruthy();
    await transport.terminateSession();
    const stale = await fetch(`${url}/mcp`, {
      headers: { authorization: `Bearer ${TOKEN}`, "mcp-session-id": id!, accept: "text/event-stream" },
    });
    expect(stale.status).toBe(404);
  });

  it.each([
    { origin: "https://evil.example.com" },
    { origin: "null" },
    { origin: "http://localhost.evil.example.com" },
    { host: "evil.example.com" },
    { host: "localhost@evil.example.com" },
  ])("rejects rebinding headers %j", async (headers) => {
    const url = await start();
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(`${url}/mcp`, { method: "POST", headers: { ...headers, authorization: `Bearer ${TOKEN}` } }, (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode));
      });
      req.on("error", reject);
      req.end();
    });
    expect(status).toBe(403);
  });

  it("accepts a loopback Origin", async () => {
    const url = await start();
    const response = await fetch(`${url}/mcp`, { method: "POST", headers: { origin: url } });
    expect(response.status).toBe(401);
  });

  it.each([undefined, "", "   "])("refuses missing or blank HTTP tokens", async (token) => {
    configure({ REELGREP_MCP_HTTP_TOKEN: token });
    await expect(createHttpServer()).rejects.toThrow(/REELGREP_MCP_HTTP_TOKEN/);
  });

  it.each(["-1", "65536", "abc", "3000suffix", "1.5"])("refuses invalid port %s", async (port) => {
    configure({ REELGREP_MCP_HTTP_PORT: port });
    await expect(createHttpServer()).rejects.toThrow(/REELGREP_MCP_HTTP_PORT/);
  });

  it("limits request bytes before JSON parsing", async () => {
    const url = await start();
    const response = await fetch(`${url}/mcp`, {
      method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: "x".repeat(1_048_577),
    });
    expect(response.status).toBe(413);
  });

  it("limits chunked bodies without a Content-Length", async () => {
    const url = await start();
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(`${url}/mcp`, {
        method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      }, (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode));
      });
      req.on("error", reject);
      req.write("x".repeat(600_000));
      req.end("x".repeat(600_000));
    });
    expect(status).toBe(413);
  });

  it("expires idle sessions even with an SSE channel open", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const url = await start();
    const { transport } = await connect(url);
    const id = transport.sessionId!;
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 31 * 60_000);
    await vi.advanceTimersByTimeAsync(60_000);
    const response = await fetch(`${url}/mcp`, {
      headers: { authorization: `Bearer ${TOKEN}`, "mcp-session-id": id, accept: "text/event-stream" },
    });
    expect(response.status).toBe(404);
  });

  it.each([undefined, "false", "1"])("blocks local index access without explicit true opt-in: %s", async (value) => {
    const url = await start({ REELGREP_MCP_HTTP_LOCAL_FILES: value, REELGREP_DB_PATH: join(directory, "missing.sqlite") });
    const { client } = await connect(url);
    expect((await client.listTools()).tools).toHaveLength(9);
    for (const name of ["reelgrep_health", "reelgrep_list_videos", "reelgrep_list_searches", "reelgrep_get_search_matches", "reelgrep_list_exports"]) {
      const result = await client.callTool({ name, arguments: name === "reelgrep_get_search_matches" ? { search_id: 1 } : {} });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain("REELGREP_MCP_HTTP_LOCAL_FILES");
    }
  });

  it("keeps concurrent sessions independent when one closes its index", async () => {
    const url = await start();
    const [a, b] = await Promise.all([connect(url), connect(url)]);
    expect(a.transport.sessionId).not.toBe(b.transport.sessionId);
    const before = await b.client.callTool({ name: "reelgrep_list_exports", arguments: {} });
    expect(before.isError).not.toBe(true);
    expect(JSON.parse((before.content as { text: string }[])[0].text).count).toBe(5);
    const matches = await a.client.callTool({ name: "reelgrep_get_search_matches", arguments: { search_id: 1 } });
    expect(matches.isError).not.toBe(true);
    await a.transport.terminateSession();
    const after = await b.client.callTool({ name: "reelgrep_list_exports", arguments: {} });
    expect(after).toEqual(before);
    const health = await b.client.callTool({ name: "reelgrep_health", arguments: {} });
    expect(health.isError).not.toBe(true);
    expect(JSON.parse((health.content as { text: string }[])[0].text).video_count).toBe(2);
  });

  it("caps sessions and frees capacity when a session terminates", async () => {
    const url = await start({ REELGREP_MCP_HTTP_LOCAL_FILES: undefined });
    const initialize = () => fetch(`${url}/mcp`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {
        protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "capacity-test", version: "1" },
      } }),
    });
    const replies = await Promise.all(Array.from({ length: 128 }, initialize));
    for (const reply of replies) {
      expect(reply.status).toBe(200);
      await reply.text();
    }
    const overflow = await initialize();
    expect(overflow.status).toBe(503);
    await overflow.text();
    const removed = await fetch(`${url}/mcp`, { method: "DELETE", headers: {
      authorization: `Bearer ${TOKEN}`, "mcp-session-id": replies[0].headers.get("mcp-session-id")!,
    } });
    expect(removed.status).toBe(200);
    await removed.text();
    const replacement = await initialize();
    expect(replacement.status).toBe(200);
    await replacement.text();
  });

  it("closes active sessions and the listener idempotently", async () => {
    const url = await start();
    await connect(url);
    await Promise.all([http!.close(), http!.close()]);
    await expect(fetch(`${url}/healthz`)).rejects.toThrow();
  });
});
