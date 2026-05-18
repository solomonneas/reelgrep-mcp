// Shared helpers for tool response formatting. Keeps every tool handler
// returning the same shape without each one reimplementing try/catch.

type TextContent = { type: "text"; text: string };
type ToolResult = { content: TextContent[]; isError?: boolean };

/** Wrap a successful payload in the MCP text-content envelope. */
export function ok(payload: unknown): ToolResult {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
  };
}

/** Wrap an error (string or Error) as an MCP isError result. */
export function fail(error: unknown): ToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ error: message }, null, 2),
      },
    ],
    isError: true,
  };
}

/** Format a millisecond duration as HH:MM:SS.mmm for human-readable citations. */
export function formatMs(ms: number): string {
  const sign = ms < 0 ? "-" : "";
  const total = Math.abs(Math.trunc(ms));
  const hours = Math.floor(total / 3_600_000);
  const minutes = Math.floor((total % 3_600_000) / 60_000);
  const seconds = Math.floor((total % 60_000) / 1000);
  const millis = total % 1000;
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${sign}${pad(hours)}:${pad(minutes)}:${pad(seconds)}.${pad(millis, 3)}`;
}

/** Last path segment of a POSIX/Windows-style path. */
export function basename(p: string): string {
  const trimmed = p.replace(/[\\/]+$/, "");
  const idx = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
}
