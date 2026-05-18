# reelgrep-mcp

> MCP server for [reelgrep](https://github.com/solomonneas/reelgrep) - browse and search your local video library from any MCP client.

Status: pre-alpha, under active development.

reelgrep is a local-first command line tool that indexes a folder of videos and their subtitles into a single SQLite database. reelgrep-mcp exposes that index over the Model Context Protocol so any MCP-capable client can list videos, inspect metadata, search subtitle cues, and recall saved queries without leaving the chat surface. The server only reads the SQLite file produced by the CLI; indexing, ingest, and any destructive operation stay in reelgrep itself.

## Install

```
npm install -g reelgrep-mcp
```

Full client setup (Claude Desktop, Claude Code, OpenClaw, Hermes Agent, Codex CLI) and tool reference will land alongside the v0.1 tool rollout.

## License

MIT. See [LICENSE](LICENSE).
