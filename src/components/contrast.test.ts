import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { primaryButton, secondaryButton } from "./ui";

// Resolve the button classes against the real design tokens in globals.css and check
// CLAUDE.md §7: text contrast of at least 7:1, including the disabled state.

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const tokens = Object.fromEntries([...css.matchAll(/--color-([a-z]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]));

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Text and background colors a class string applies, optionally for a variant like "disabled:". */
function colors(classes: string, variant = ""): { text: string; bg: string } {
  const pick = (kind: "text" | "bg") => {
    const names = classes
      .split(/\s+/)
      .filter((c) => c.startsWith(`${variant}${kind}-`) && c.split(":").length === (variant ? 2 : 1))
      .map((c) => c.slice(`${variant}${kind}-`.length))
      .filter((name) => name in tokens);
    expect(names, `${variant}${kind}- in "${classes}"`).toHaveLength(1);
    return tokens[names[0]];
  };
  return { text: pick("text"), bg: pick("bg") };
}

describe("button contrast (≥ 7:1)", () => {
  it("reads the design tokens", () => {
    expect(tokens).toMatchObject({ ink: "#0e0f0e", white: "#ffffff", free: "#dce3e6", muted: "#454b47" });
  });

  it("primary button, enabled and disabled", () => {
    const enabled = colors(primaryButton);
    expect(contrast(enabled.text, enabled.bg)).toBeGreaterThanOrEqual(7);
    const disabled = colors(primaryButton, "disabled:");
    expect(contrast(disabled.text, disabled.bg)).toBeGreaterThanOrEqual(7);
    // The disabled state must still look different from the enabled one.
    expect(disabled.bg).not.toBe(enabled.bg);
  });

  it("secondary button", () => {
    const { text, bg } = colors(secondaryButton);
    expect(contrast(text, bg)).toBeGreaterThanOrEqual(7);
  });
});
