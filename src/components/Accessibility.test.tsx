// @vitest-environment jsdom
// Step 7: keyboard and screen-reader focus. Focus must never be lost to the page body after an
// action, and controls at a limit stay focusable (aria-disabled) instead of dropping focus.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTournament } from "../engine/bracket";
import type { AppState, Rng, Tournament } from "../engine/types";
import { STORAGE_KEY } from "../lib/storage";
import NextBestApp, { NEW_MATCH_TAP_GUARD_MS } from "./NextBestApp";

const START = new Date("2026-03-01T10:00:00.000Z").getTime();
const names = (n: number) => Array.from({ length: n }, (_, i) => `Player ${i + 1}`);

function seededRng(seed: number): Rng {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let x = s;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(START);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const stored = (): AppState => JSON.parse(localStorage.getItem(STORAGE_KEY)!);
const button = (name: string) => screen.getByRole("button", { name });
const focused = () => document.activeElement;
const tournament = (players: number, tables: number) =>
  createTournament(names(players), tables, seededRng(1), new Date(START).toISOString());

function openGrid(t: Tournament, history: string[] = []) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ tournament: t, history, lang: "ru" }));
  render(<NextBestApp />);
  fireEvent.click(button("Продолжить турнир"));
}

function tap(table: number) {
  const t = stored().tournament!;
  const m = t.matches[t.tables[table]!];
  vi.setSystemTime(Date.now() + NEW_MATCH_TAP_GUARD_MS + 1);
  const target = within(screen.getByRole("article", { name: `Стол ${table + 1}` })).getByRole("button", {
    name: `${t.players[m.a!].name} выигрывает, стол ${table + 1}`,
  });
  target.focus();
  fireEvent.click(target);
}

describe("focus after screen changes", () => {
  it("is not moved on first load", () => {
    render(<NextBestApp />);
    expect(focused()).toBe(document.body);
  });

  it("goes to the new screen's heading after Start, New, Cancel and Continue", () => {
    render(<NextBestApp />);
    fireEvent.change(screen.getByRole("textbox", { name: "Игроки" }), { target: { value: names(6).join("\n") } });
    fireEvent.click(button("Начать турнир"));
    expect(focused()).toBe(screen.getByRole("heading", { name: "Турнир", level: 1 }));

    fireEvent.click(button("Новый турнир"));
    expect(focused()).toBe(screen.getByRole("heading", { name: "Начать новый турнир? Текущий будет удалён." }));
    fireEvent.click(button("Отмена"));
    expect(focused()).toBe(screen.getByRole("heading", { name: "Турнир", level: 1 }));

    fireEvent.click(button("Новый турнир"));
    fireEvent.click(button("Да, начать новый"));
    expect(focused()).toBe(screen.getByRole("heading", { name: "Новый турнир" }));

    cleanup();
    openGrid(tournament(8, 4));
    expect(focused()).toBe(screen.getByRole("heading", { name: "Турнир", level: 1 }));
  });

  it("after New on the recovery screen, goes to the setup heading", () => {
    localStorage.setItem(STORAGE_KEY, "{broken");
    render(<NextBestApp />);
    fireEvent.click(button("Новый турнир"));
    expect(focused()).toBe(screen.getByRole("heading", { name: "Новый турнир" }));
  });

  it("goes to the champion heading when the final is decided", () => {
    openGrid(tournament(5, 2));
    while (!stored().tournament!.champion) tap(stored().tournament!.tables.findIndex((id) => id !== null));
    const champion = stored().tournament!;
    expect(focused()).toBe(
      screen.getByRole("heading", { name: `Чемпион ${champion.players[champion.champion!].name}` }),
    );
  });
});

describe("focus on the tables screen", () => {
  it("a winner tap keeps focus on that table, also when the table becomes free", () => {
    openGrid(tournament(12, 2)); // matches are waiting: the table gets the next one
    tap(0);
    expect(focused()).toBe(screen.getByRole("heading", { name: "Стол 1" }));
    expect(within(screen.getByRole("article", { name: "Стол 1" })).getAllByRole("button")).toHaveLength(2);

    cleanup();
    localStorage.clear();
    openGrid(tournament(8, 4)); // nothing waits: the table becomes free
    tap(2);
    expect(within(screen.getByRole("article", { name: "Стол 3" })).queryAllByRole("button")).toHaveLength(0);
    expect(focused()).toBe(screen.getByRole("heading", { name: "Стол 3" }));
  });

  it("Undo keeps focus when the history runs out and then does nothing", () => {
    openGrid(tournament(12, 2));
    tap(0);
    const undo = button("Отменить последнее действие");
    undo.focus();
    fireEvent.click(undo);
    expect(focused()).toBe(undo);
    expect(undo.getAttribute("aria-disabled")).toBe("true");
    expect(undo.hasAttribute("disabled")).toBe(false);
    const before = localStorage.getItem(STORAGE_KEY);
    fireEvent.click(undo);
    expect(localStorage.getItem(STORAGE_KEY)).toBe(before);
  });

  it("table −/+ keep focus at 1 and 16 and do nothing there", () => {
    openGrid(tournament(8, 15));
    const more = button("Больше столов");
    more.focus();
    fireEvent.click(more);
    expect(more.getAttribute("aria-disabled")).toBe("true");
    expect(focused()).toBe(more);
    const at16 = localStorage.getItem(STORAGE_KEY);
    fireEvent.click(more);
    expect(localStorage.getItem(STORAGE_KEY)).toBe(at16);
    expect(stored().tournament!.tables).toHaveLength(16);
  });

  it("setup −/+ keep focus at 1 and 16", () => {
    render(<NextBestApp />);
    const fewer = button("Меньше столов");
    fewer.focus();
    for (let i = 0; i < 5; i++) fireEvent.click(fewer);
    expect((screen.getByRole("textbox", { name: "Количество столов" }) as HTMLInputElement).value).toBe("1");
    expect(fewer.getAttribute("aria-disabled")).toBe("true");
    expect(focused()).toBe(fewer);
  });
});

describe("keyboard-safe markup", () => {
  const dir = join(process.cwd(), "src", "components");
  const sources = readdirSync(dir)
    .filter((f) => f.endsWith(".tsx") && !f.includes(".test."))
    .map((f) => [f, readFileSync(join(dir, f), "utf8")] as const);

  it("only native buttons have click handlers", () => {
    expect(sources.map(([file]) => file)).toEqual(expect.arrayContaining(["GridScreen.tsx", "NextBestApp.tsx", "SetupScreen.tsx"]));
    for (const [file, src] of sources) {
      expect(src, file).not.toMatch(/<(div|span|p|li|ol|ul|section|article|h\d|header|main|svg)\b[^>]*\bonClick=/);
    }
  });

  it("no positive tabIndex changes the natural focus order", () => {
    for (const [file, src] of sources) expect(src, file).not.toMatch(/tabIndex=\{[1-9]/);
  });
});
