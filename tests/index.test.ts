import { describe, it, expect } from "vitest";

describe("reelgrep-mcp bootstrap", () => {
  it("loads config without throwing", async () => {
    const { getConfig } = await import("../src/config.js");
    const cfg = getConfig();
    expect(cfg).toHaveProperty("dbPath");
    expect(typeof cfg.dbPath).toBe("string");
    expect(cfg.dbPath.length).toBeGreaterThan(0);
  });
});
