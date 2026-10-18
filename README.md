# reelgrep-mcp

> MCP server for [reelgrep](https://github.com/solomonneas/reelgrep) - browse and search your local video library from any MCP client.

Status: v0.1.1. Read-only tools (browse + search). Write operations (transcribe, export, find-person) ship via the reelgrep CLI today and may land here later if there's demand.

[reelgrep](https://github.com/solomonneas/reelgrep) is a local-first CLI that indexes a folder of videos and their subtitles into a single SQLite database. reelgrep-mcp opens that same index directly via `better-sqlite3`, so there's no second daemon to run and no HTTP hop. The headline use case is cross-library FTS5 subtitle search from a chat agent ("which lecture mentioned eventual consistency?") with the matching cue and timestamp returned inline.

## Why

- Ask a chat agent "which lecture covered ACID properties?" and get back the lecture title, timestamp, and exact cue text without switching to a browser.
- Mid-essay citation generator: `reelgrep_find_quote` returns formatted blocks ready to paste.
- Cross-class research: fan one query out across every video the agent can see.
- All local. The server reads the SQLite database that reelgrep maintains, talks to nothing else over the network, and is read-only by design.
- One file is the source of truth. Point it at the DB, restart the client, done.

## Requirements

- Node 20+.
- A reelgrep index on disk. Install and ingest at least one video first:

  ```bash
  pipx install reelgrep[whisper]
  reelgrep ingest ~/Videos/some-lecture.mp4 --transcribe
  ```

  See the [reelgrep README](https://github.com/solomonneas/reelgrep) for the full setup, including transcription model selection and batch ingest.
- Default DB path: `~/.local/share/reelgrep/index.sqlite`. Override via `REELGREP_DB_PATH`.

## Install

```bash
npm install -g reelgrep-mcp
```

Or from source:

```bash
git clone https://github.com/solomonneas/reelgrep-mcp
cd reelgrep-mcp
npm install
npm run build
```

## Configuration

Stdio configuration:

| Variable | Default | Description |
|---|---|---|
| `REELGREP_DB_PATH` | `~/.local/share/reelgrep/index.sqlite` | Absolute path to the reelgrep SQLite index. `~` is expanded. |

The server opens the DB read-only on startup and closes it cleanly on shutdown. If the file is missing or unreadable, `reelgrep_health` will surface the error rather than crashing the process.

## Tools

All tools are namespaced `reelgrep_*`. Parameters with `?` are optional.

### Browse

- `reelgrep_list_videos`(`limit?`, `offset?`) - List indexed videos, newest first. Use for "what's in my library?" prompts.
- `reelgrep_video_info`(`file_hash`) - Full metadata for one video (duration, codec, cue count, ingest timestamp, source path). Accepts an 8+ character hex prefix; the server resolves it as long as it's unambiguous.

### Search

- `reelgrep_search_subtitles`(`query`, `file_hash?`, `limit?`) - FTS5 search over every subtitle cue. If `file_hash` is provided, scopes to that video; otherwise searches across the whole library and groups hits per video. This is the headline tool.
- `reelgrep_recent_cues`(`file_hash`, `timestamp_ms`, `window_seconds?`) - Cues within `+/- window_seconds` of a timestamp. Useful for pulling context around a search hit.
- `reelgrep_find_quote`(`query`, `max_results?`) - Same data as `reelgrep_search_subtitles`, but returns formatted citation blocks ready to paste into a paper or chat reply.

### Person searches

- `reelgrep_list_searches`(`file_hash?`, `limit?`) - Past person-find runs, scoped to a video or across all videos.
- `reelgrep_get_search_matches`(`search_id`) - One search with its matches sorted by confidence.

### Exports

- `reelgrep_list_exports`(`file_hash?`, `kind?`, `limit?`) - Screenshots, clips, gifs, and contact sheets the user has exported. `kind` filters by export type.

### Diagnostics

- `reelgrep_health`() - Confirms the DB is reachable, prints the resolved DB path and indexed video count. Run this first if anything looks off.

## CLI

The same package ships a read-only **search tool**, `reelgrep`, for shells, cron, and CI. It reads the same local reelgrep SQLite index.

```bash
npx reelgrep@latest subtitles search "schema design" --limit 5
# or, installed globally, simply:
reelgrep videos list
reelgrep videos info 8b63a736
reelgrep subtitles search "eventual consistency"
reelgrep subtitles cues 8b63a736 300000 --window 15
reelgrep quote find "ACID properties"
reelgrep searches list
reelgrep searches matches 1
reelgrep exports list --kind clip
reelgrep health            # exit 1 if the index is not reachable (cron-friendly)
reelgrep --json videos list  # raw JSON for piping
```

Run `reelgrep help` for the full flag list. Configure with `REELGREP_DB_PATH` (default `~/.local/share/reelgrep/index.sqlite`).

Exit codes: `0` success; `1` runtime error (index missing or unreadable, or `health` when the index cannot be opened); `2` usage error (unknown command/flag or a bad value).

### Starting the MCP server

`reelgrep mcp` (or the back-compat `reelgrep-mcp` bin) starts the stdio MCP server. If a launcher referenced the file path `dist/index.js` directly, point it at `dist/mcp-bin.js` (or `dist/cli.js mcp`); launchers that use the `reelgrep-mcp` bin name need no change.

## HTTP mode

Run one process shared by multiple MCP clients:

```sh
node dist/mcp-bin.js --http
# Or: node dist/cli.js mcp --http
```

Set these variables in the server environment before starting:

| Variable | Default | Purpose |
| --- | --- | --- |
| `REELGREP_MCP_HTTP_TOKEN` | Required | Independent bearer token. Blank values prevent startup |
| `REELGREP_MCP_HTTP_HOST` | IPv4 loopback | Listener bind address |
| `REELGREP_MCP_HTTP_PORT` | `18816` | TCP port. `0` selects a free port |
| `REELGREP_DB_PATH` | See Configuration | Operator-selected index file, shared read-only by authorized clients |

Generate an HTTP token with `openssl rand -hex 32` and store it privately.
This server holds no upstream credentials. Authentication compares SHA-256
hashes with `timingSafeEqual`. The token is never logged or returned by tools.
The resolved listening address is printed to stderr.

`/mcp` serves stateful Streamable HTTP with bearer authentication on POST, GET,
and DELETE. Unauthenticated `GET /healthz` returns only `{"status":"ok"}`.
Host and Origin checks run before authentication: Host must match the bound host
or a loopback alias, and a supplied Origin must be an HTTP or HTTPS loopback
origin. Request bodies are limited to 1 MiB, including chunked requests. Request
and header timeouts are 30 and 10 seconds. The service accepts up to 128 sessions,
reaps sessions idle for 30 minutes on a minute timer, and closes sessions and the
listener on SIGTERM or SIGINT. Active POST requests are excluded from idle
expiry. An idle SSE connection does not keep a session alive.

No tool accepts a filesystem path. Tools read only the operator-configured
`REELGREP_DB_PATH` index and return recorded paths without opening media or
artifact files. Each session opens its own read-only SQLite handle for that index
and closes it on session shutdown. The index path is captured when the listener
starts.

Saved searches, matches, and export records are existing SQLite rows shared
read-only by every authorized session. There are no pending approvals, match
caches, deferred tool sets, export jobs, or mutable process-wide tool state.
Tools return metadata and recorded file paths. They do not open videos,
subtitles, frames, or exported artifacts, and cannot create clips or cues.
No tool accepts a filesystem path or promises a confinement directory. The only
opened file is the operator-configured SQLite index (and SQLite-managed sidecar
files). No artifact-directory confinement is claimed.

All clients with the bearer token share access to the same library. Session IDs
route protocol state and do not identify separate users. Keep the default
loopback binding. Remote access needs a trusted TLS proxy or tunnel and network
access controls. Preserve an allowed Host header. Wildcard binding does not
permit arbitrary Host headers. Clients must reinitialize after idle expiry or
a service restart.

### Claude Code

The helper reads the token from its environment and prints an authorization
header object. Save this as an executable helper outside the repository:

```python
#!/usr/bin/env python3
import json
import os
import sys

print(json.dumps({"Authorization": "Bearer " + os.environ[sys.argv[1]]}))
```

Configure the client with the same token environment variable:

```json
{
  "mcpServers": {
    "reelgrep": {
      "type": "http",
      "url": "http://localhost:18816/mcp",
      "headersHelper": "/path/to/helper REELGREP_MCP_HTTP_TOKEN"
    }
  }
}
```

### Codex

Use streamable HTTP with an environment-backed bearer token:

```toml
[mcp_servers.reelgrep]
url = "http://localhost:18816/mcp"
bearer_token_env_var = "REELGREP_MCP_HTTP_TOKEN"
```

### systemd user service

An example unit is in [docs/systemd/reelgrep-mcp-http.service](docs/systemd/reelgrep-mcp-http.service).
Adjust the install path and Node executable. Create its EnvironmentFile with mode
`0600` before adding secrets. It should contain `REELGREP_MCP_HTTP_TOKEN`,
and `REELGREP_DB_PATH`.
The unit applies `NoNewPrivileges=true`, `PrivateTmp=true`, and `UMask=0077`.

## Setup

Configuration snippets for each MCP client. Pick the one that matches your setup; the env var (`REELGREP_DB_PATH`) is the same everywhere.

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "reelgrep": {
      "command": "npx",
      "args": ["-y", "reelgrep-mcp"],
      "env": {
        "REELGREP_DB_PATH": "/path/to/index.sqlite"
      }
    }
  }
}
```

Restart Claude Desktop after editing.

### Claude Code

```bash
claude mcp add reelgrep -- npx -y reelgrep-mcp
```

Or with an explicit DB path:

```bash
claude mcp add reelgrep --env REELGREP_DB_PATH=/abs/path/index.sqlite -- npx -y reelgrep-mcp
```

Add `--scope user` to make it available from any directory instead of only the current project.

### OpenClaw

```bash
openclaw mcp set reelgrep --command "npx" --arg "-y" --arg "reelgrep-mcp" \
  --env REELGREP_DB_PATH=/path/to/index.sqlite
```

Or edit `~/.openclaw/openclaw.json` directly if you prefer. Restart the gateway after either:

```bash
systemctl --user restart openclaw-gateway
openclaw mcp list   # confirm "reelgrep" is registered
```

### Hermes Agent

Add to `~/.hermes/config.yaml` under `mcp_servers`:

```yaml
mcp_servers:
  reelgrep:
    command: npx
    args: ["-y", "reelgrep-mcp"]
    env:
      REELGREP_DB_PATH: /path/to/index.sqlite
```

Reload MCP from inside a Hermes session:

```
/reload-mcp
```

### Codex CLI

```bash
codex mcp add reelgrep -- npx -y reelgrep-mcp
```

With an explicit DB path:

```bash
codex mcp add reelgrep \
  --env REELGREP_DB_PATH=/path/to/index.sqlite \
  -- npx -y reelgrep-mcp
```

Codex writes the entry to `~/.codex/config.toml` under `[mcp_servers.reelgrep]`. Verify with:

```bash
codex mcp list
```

## Example prompts

> Which lectures in my library cover Kubernetes networking?

Calls `reelgrep_search_subtitles` with `query="kubernetes networking"`, returns one hit group per matching video with timestamps.

> Find every cue across my videos that mentions ACID properties, formatted as citations I can paste into a paper.

Calls `reelgrep_find_quote` and returns pre-formatted blocks (video title, timestamp, cue text).

> List the videos I've ingested in the last week with their cue counts.

`reelgrep_list_videos` (newest first), then `reelgrep_video_info` per hash for the cue counts.

> Show me the cues around the 5-minute mark of Module_1-1.mp4 - I want the context around what the prof said about schemas.

`reelgrep_list_videos` to resolve the hash, then `reelgrep_recent_cues` with `timestamp_ms=300000` and a window like `30`.

> What person searches have I run against Module_3-2.mp4 and what were the top matches?

`reelgrep_list_searches` scoped by the file hash, then `reelgrep_get_search_matches` on the search ID of interest.

## How it works

The MCP server opens the reelgrep SQLite index in read-only mode via `better-sqlite3`, holds it for the lifetime of the process, and closes it on shutdown. No second daemon required; the index file is the single source of truth. Because reads are local SQLite calls, latency is dominated by FTS5 query cost rather than IPC, so cross-library subtitle search stays fast even on libraries with hundreds of hours of indexed video.

The reelgrep CLI is the write side: it ingests videos, samples frames, extracts and transcribes subtitles, runs face matching, and exports clips. reelgrep-mcp only reads what's already in the DB. If you want a tool that writes (a new export, a fresh transcription, a person search), run the reelgrep CLI directly today, or open an issue to discuss a read-write tool surface.

## Development

```bash
git clone https://github.com/solomonneas/reelgrep-mcp
cd reelgrep-mcp
npm install
npm run typecheck
npm test
npm run build
```

To run the server in stdio mode against your own DB while iterating:

```bash
REELGREP_DB_PATH=$HOME/.local/share/reelgrep/index.sqlite npm run dev
```

Test interactively with the [MCP Inspector](https://github.com/modelcontextprotocol/inspector):

```bash
npx @modelcontextprotocol/inspector node dist/mcp-bin.js
```

The inspector lets you call each tool with arbitrary inputs and see raw responses, which is the fastest way to validate a new tool handler.

### Project layout

```
src/
  index.ts         # MCP server entry, registers all tools
  db.ts            # better-sqlite3 connection + schema helpers
  tools/
    browse.ts      # list_videos, video_info
    search.ts      # search_subtitles, recent_cues, find_quote
    people.ts      # list_searches, get_search_matches
    exports.ts     # list_exports
    health.ts      # health
tests/             # vitest suites, one per tool module
```

Each tool module exports a registration function that takes the MCP server and the DB handle, and registers its tools with input schemas defined via Zod. The DB handle is shared across tools so the file is opened once per process.

### Adding a tool

1. Pick the right module under `src/tools/` (or create a new one).
2. Define the input schema with Zod, the handler, and register it via `server.tool(...)`.
3. Add a vitest suite under `tests/` that exercises the SQL path against a fixture DB.
4. Update the Tools section of this README.
5. Run `npm run typecheck && npm test && npm run build`.

If the new tool needs to write to the index, stop and reconsider: the contract for v0.1.x is read-only. Writes belong in the reelgrep CLI unless there's a concrete reason to move one over (open an issue).

## Troubleshooting

**`reelgrep_health` reports the DB cannot be opened.**
The `REELGREP_DB_PATH` is wrong, the file does not exist, or the user running the MCP client cannot read it. Check the path resolves (`ls -l "$REELGREP_DB_PATH"`) and that you have run `reelgrep ingest` at least once.

**Tools return zero results for queries you know should match.**
The index might be empty. Run `reelgrep_list_videos` and `reelgrep_video_info` on one of the returned hashes to confirm there are cues. If the cue count is zero, the source video was ingested without a subtitle track and without `--transcribe`; re-ingest with transcription enabled.

**`reelgrep_search_subtitles` returns hits but the timestamps look off.**
Timestamps are in milliseconds from the start of the source file, as written by the reelgrep ingest path. If the source file has a non-zero start offset (rare but possible with concatenated MKVs), reelgrep records the offset-adjusted time. Compare against the raw subtitle file via the reelgrep CLI to confirm.

**The server opens but the client says the tool is not available.**
Restart the MCP client after editing config. For OpenClaw, also restart the gateway (`systemctl --user restart openclaw-gateway`) and confirm with `openclaw mcp list`.

**`better-sqlite3` fails to load on install.**
Native binding mismatch. `npm rebuild better-sqlite3` against your installed Node version, or reinstall with `npm install -g reelgrep-mcp --force`. Node 20+ is required.

## License

MIT. See [LICENSE](LICENSE).
