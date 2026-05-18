import { describe, it, expect } from "vitest";
import { ok, fail, formatMs, basename } from "../src/tools/_util.js";

describe("ok()", () => {
  it("wraps a payload in MCP text content with pretty JSON", () => {
    const r = ok({ hello: "world" });
    expect(r.isError).toBeUndefined();
    expect(r.content).toHaveLength(1);
    expect(r.content[0].type).toBe("text");
    expect(JSON.parse(r.content[0].text)).toEqual({ hello: "world" });
    expect(r.content[0].text).toContain("\n  ");
  });
});

describe("fail()", () => {
  it("wraps an Error with isError=true and an error message", () => {
    const r = fail(new Error("boom"));
    expect(r.isError).toBe(true);
    expect(JSON.parse(r.content[0].text)).toEqual({ error: "boom" });
  });

  it("accepts a string and stringifies it", () => {
    const r = fail("nope");
    expect(r.isError).toBe(true);
    expect(JSON.parse(r.content[0].text)).toEqual({ error: "nope" });
  });
});

describe("formatMs()", () => {
  it("formats sub-second values", () => {
    expect(formatMs(123)).toBe("00:00:00.123");
  });
  it("formats minute-scale values", () => {
    expect(formatMs(125_500)).toBe("00:02:05.500");
  });
  it("formats hour-scale values", () => {
    expect(formatMs(3_661_001)).toBe("01:01:01.001");
  });
  it("formats negative values with a leading sign", () => {
    expect(formatMs(-1500)).toBe("-00:00:01.500");
  });
});

describe("basename()", () => {
  it("returns the last POSIX segment", () => {
    expect(basename("/srv/lectures/Module_1-1.mp4")).toBe("Module_1-1.mp4");
  });
  it("returns the last Windows segment", () => {
    expect(basename("C:\\videos\\foo.mkv")).toBe("foo.mkv");
  });
  it("returns the input when no separator is present", () => {
    expect(basename("foo.mkv")).toBe("foo.mkv");
  });
});
