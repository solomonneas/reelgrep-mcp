import { homedir } from "node:os";
import { resolve } from "node:path";

export interface ReelgrepConfig {
  dbPath: string;
}

function expandHome(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return resolve(homedir(), p.slice(2));
  return p;
}

export function getConfig(): ReelgrepConfig {
  const raw =
    process.env.REELGREP_DB_PATH ?? "~/.local/share/reelgrep/index.sqlite";
  const dbPath = resolve(expandHome(raw));
  return { dbPath };
}
