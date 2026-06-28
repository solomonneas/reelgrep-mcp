import { serve } from "./index.js";

serve().catch((error: unknown) => {
  const msg = error instanceof Error ? error.message : String(error);
  console.error(`reelgrep-mcp fatal: ${msg}`);
  process.exit(1);
});
