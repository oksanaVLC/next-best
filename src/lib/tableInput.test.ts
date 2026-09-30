import { describe, expect, it } from "vitest";
import { parseTableInput, stepTableInput } from "./tableInput";

describe("parseTableInput", () => {
  it("accepts whole numbers from 1 to 16", () => {
    for (let n = 1; n <= 16; n++) expect(parseTableInput(String(n))).toBe(n);
    expect(parseTableInput(" 7 ")).toBe(7);
    expect(parseTableInput("04")).toBe(4);
  });

  it("rejects everything else", () => {
    for (const text of ["", " ", "0", "17", "100", "-1", "2.5", "1e1", "abc", "4a", "+4", "٤"]) {
      expect(parseTableInput(text), text).toBeNull();
    }
  });
});

describe("stepTableInput", () => {
  it("moves by one and stops at the limits", () => {
    expect(stepTableInput("4", 1)).toBe(5);
    expect(stepTableInput("4", -1)).toBe(3);
    expect(stepTableInput("1", -1)).toBe(1);
    expect(stepTableInput("16", 1)).toBe(16);
    expect(stepTableInput("15", 1)).toBe(16);
    expect(stepTableInput("2", -1)).toBe(1);
  });

  it("snaps an invalid value into range first", () => {
    expect(stepTableInput("20", -1)).toBe(16);
    expect(stepTableInput("20", 1)).toBe(16);
    expect(stepTableInput("0", 1)).toBe(1);
    expect(stepTableInput("0", -1)).toBe(1);
    expect(stepTableInput("", 1)).toBe(4);
    expect(stepTableInput("abc", -1)).toBe(4);
    expect(stepTableInput("99999999999999999999", -1)).toBe(16);
  });
});
