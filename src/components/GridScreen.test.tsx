// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTournament } from "../engine/bracket";
import { pickWinner, queue } from "../engine/play";
import type { AppState, Rng, Tournament } from "../engine/types";
import { STORAGE_KEY } from "../lib/storage";
import NextBestApp, { NEW_MATCH_TAP_GUARD_MS } from "./NextBestApp";

// --- helpers ----------------------------------------------------------------

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
  vi.useFakeTimers({ toFake: ["Date"] }); // only the clock; React and Testing Library keep real timers
  vi.setSystemTime(START);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const nowIso = () => new Date().toISOString();

function tournament(players: number, tables: number, seed = 1): Tournament {
  return createTournament(names(players), tables, seededRng(seed), new Date(START).toISOString());
}

function stored(): AppState {
  return JSON.parse(localStorage.getItem(STORAGE_KEY)!);
}

/** Save `t`, open the app and press Continue: the grid without any NEW highlight. */
function openGrid(t: Tournament, history: string[] = []) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ tournament: t, history, lang: "ru" }));
  render(<NextBestApp />);
  fireEvent.click(screen.getByRole("button", { name: "Продолжить турнир" }));
}

const tile = (i: number) => screen.getByRole("article", { name: `Стол ${i + 1}` });
const tiles = () => screen.getAllByRole("article");
const waitingPanel = () => screen.getByRole("region", { name: "Ждут стол" });
const noWaitingPanel = () => expect(screen.queryByRole("region", { name: "Ждут стол" })).toBeNull();
const playerName = (t: Tournament, id: string) => t.players[id].name;

function winButton(t: Tournament, table: number, playerId: string) {
  return within(tile(table)).getByRole("button", { name: `${playerName(t, playerId)} выигрывает, стол ${table + 1}` });
}

/** Tap a winner the way the organizer does, after the NEW tap guard has passed. */
function tap(t: Tournament, table: number, playerId: string) {
  vi.setSystemTime(Date.now() + NEW_MATCH_TAP_GUARD_MS + 1);
  fireEvent.click(winButton(t, table, playerId));
}

/** Every tile shows exactly what the engine says is on that table. */
function expectGridMatches(t: Tournament) {
  expect(tiles()).toHaveLength(t.tables.length);
  t.tables.forEach((matchId, i) => {
    const el = tile(i);
    if (matchId === null) {
      expect(within(el).getByText("Свободен")).toBeTruthy();
      expect(within(el).queryAllByRole("button")).toHaveLength(0);
      return;
    }
    const m = t.matches[matchId];
    const buttons = within(el).getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual([playerName(t, m.a!), playerName(t, m.b!)]);
  });
}

function expectWaiting(t: Tournament) {
  if (queue(t).length === 0) return noWaitingPanel(); // the panel is hidden when nothing waits
  const expected = queue(t)
    .slice(0, 6)
    .map((m) => `${playerName(t, m.a!)} — ${playerName(t, m.b!)}`);
  const items = within(waitingPanel()).queryAllByRole("listitem").map((li) => li.textContent);
  expect(items.slice(0, expected.length)).toEqual(expected);
  expect(within(waitingPanel()).queryAllByRole("button")).toHaveLength(0);
}

const newTables = () => tiles().flatMap((el, i) => (within(el).queryByText("НОВЫЙ") ? [i] : []));

// --- tests --------------------------------------------------------------------

describe("tables grid", () => {
  it("Start from Setup reaches the grid, with every assigned table marked NEW", () => {
    vi.spyOn(Math, "random").mockImplementation(seededRng(5));
    render(<NextBestApp />);
    fireEvent.change(screen.getByRole("textbox", { name: "Игроки" }), { target: { value: names(12).join("\n") } });
    fireEvent.change(screen.getByRole("textbox", { name: "Количество столов" }), { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: "Начать турнир" }));

    const t = stored().tournament!;
    expect(screen.getByRole("heading", { name: "Турнир" })).toBeTruthy();
    expect(screen.getByText("Сыграно матчей: 0 из 11 · осталось 12 игроков")).toBeTruthy();
    expectGridMatches(t);
    expectWaiting(t);
    expect(newTables()).toEqual(t.tables.flatMap((id, i) => (id === null ? [] : [i])));
  });

  it("shows both players on busy tables, Free on empty ones, and round names", () => {
    const t = tournament(8, 7);
    openGrid(t);
    expectGridMatches(t);
    expect(t.tables.slice(4)).toEqual([null, null, null]);
    for (const i of [0, 1, 2, 3]) expect(within(tile(i)).getByText("Четвертьфинал")).toBeTruthy();
    expect(newTables()).toEqual([]); // nothing is new after Continue
  });

  it("lists waiting matches in order, not as buttons, and summarises long queues", () => {
    const t = tournament(12, 2);
    openGrid(t);
    expectWaiting(t);

    cleanup();
    localStorage.clear();
    const big = tournament(30, 1);
    expect(queue(big)).toHaveLength(13);
    openGrid(big);
    expectWaiting(big);
    expect(within(waitingPanel()).getByText("и ещё 7 матчей")).toBeTruthy();
  });

  it("with enough tables nobody waits, and new matches start on the lowest free table", () => {
    let t = tournament(8, 16);
    openGrid(t);
    noWaitingPanel();
    expectGridMatches(t);

    for (const table of [0, 1]) {
      const m = t.matches[t.tables[table]!];
      tap(t, table, m.a!);
      t = pickWinner(t, m.id, m.a!, nowIso());
    }
    // Both quarterfinal winners meet in 2-0, which goes straight to "Стол 1", the lowest free table.
    expect(t.tables[0]).toBe("2-0");
    expectGridMatches(t);
    expect(within(tile(0)).getByText("Полуфинал")).toBeTruthy();
    expect(newTables()).toEqual([0]);
    noWaitingPanel();
  });
});

describe("tapping a winner", () => {
  it("applies pickWinner, saves once with history, refills the table and marks it NEW", () => {
    const t = tournament(12, 2);
    const history = [JSON.stringify(tournament(12, 2, 99))];
    openGrid(t, history);
    const m = t.matches[t.tables[0]!];
    const nextUp = queue(t)[0];

    tap(t, 0, m.b!);

    const expected = pickWinner(t, m.id, m.b!, nowIso());
    expect(stored()).toEqual({ tournament: expected, history: [...history, JSON.stringify(t)], lang: "ru" });
    expect(expected.log).toHaveLength(1);
    expect(expected.players[m.a!].out).toBe(true);
    expect(expected.matches[`2-${Math.floor(m.position / 2)}`][m.position % 2 === 0 ? "a" : "b"]).toBe(m.b);
    expect(expected.tables[0]).toBe(nextUp.id);

    expectGridMatches(expected);
    expectWaiting(expected);
    expect(newTables()).toEqual([0]);
    expect(screen.getByText("Сыграно матчей: 1 из 11 · осталось 11 игроков")).toBeTruthy();
    expect(screen.queryByRole("button", { name: new RegExp(`^${playerName(t, m.a!)} `) })).toBeNull();
  });

  it("a double tap cannot pick a winner in the match that just replaced it", () => {
    const t = tournament(12, 1);
    openGrid(t);
    const m = t.matches[t.tables[0]!];
    tap(t, 0, m.a!);
    const after = stored();
    const next = after.tournament!.matches[after.tournament!.tables[0]!];

    // Second and third taps land on the new match's first name within the guard time.
    vi.setSystemTime(Date.now() + 200);
    fireEvent.click(winButton(after.tournament!, 0, next.a!));
    vi.setSystemTime(Date.now() + 500);
    fireEvent.click(winButton(after.tournament!, 0, next.a!));
    expect(stored()).toEqual(after);
    expect(stored().tournament!.log).toHaveLength(1);
    expect(stored().history).toHaveLength(1);

    // A deliberate tap after the guard counts.
    tap(after.tournament!, 0, next.a!);
    expect(stored().tournament!.log).toHaveLength(2);
    expect(stored().history).toHaveLength(2);
  });

  it("right after Start, taps wait for the guard too", () => {
    vi.spyOn(Math, "random").mockImplementation(seededRng(8));
    render(<NextBestApp />);
    fireEvent.change(screen.getByRole("textbox", { name: "Игроки" }), { target: { value: names(6).join("\n") } });
    fireEvent.click(screen.getByRole("button", { name: "Начать турнир" }));
    const t = stored().tournament!;
    const m = t.matches[t.tables[0]!];
    fireEvent.click(winButton(t, 0, m.a!));
    expect(stored().tournament!.log).toHaveLength(0);
    tap(t, 0, m.a!);
    expect(stored().tournament!.log).toHaveLength(1);
  });

  it("offers nothing to tap for free tables, waiting matches or eliminated players", () => {
    let t = tournament(8, 4);
    openGrid(t);
    const m = t.matches[t.tables[0]!];
    tap(t, 0, m.a!);
    t = stored().tournament!;
    expect(t.tables[0]).toBeNull(); // nothing was waiting
    expect(within(tile(0)).queryAllByRole("button")).toHaveLength(0);
    const buttonNames = screen.getAllByRole("button").map((b) => b.getAttribute("aria-label") ?? b.textContent);
    expect(buttonNames.some((n) => n?.startsWith(`${playerName(t, m.b!)} `))).toBe(false);
    noWaitingPanel(); // nothing is waiting here
  });

  it("NEW moves to the table that received the latest match", () => {
    let t = tournament(16, 3);
    openGrid(t);
    for (const table of [2, 0, 1]) {
      const m = t.matches[t.tables[table]!];
      tap(t, table, m.a!);
      t = stored().tournament!;
      expect(newTables()).toEqual([table]);
    }
  });
});

describe("restoring and finishing", () => {
  it("a reload restores tables, waiting matches and results", () => {
    let t = tournament(12, 2, 3);
    openGrid(t);
    for (let i = 0; i < 3; i++) {
      const table = i % 2;
      const m = t.matches[t.tables[table]!];
      tap(t, table, m.b!);
      t = stored().tournament!;
    }
    const before = localStorage.getItem(STORAGE_KEY);

    cleanup();
    render(<NextBestApp />);
    expect(screen.getByText("Сыграно матчей: 3 из 11")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Продолжить турнир" }));
    expect(localStorage.getItem(STORAGE_KEY)).toBe(before);
    expectGridMatches(t);
    expectWaiting(t);
    expect(screen.getByText("Сыграно матчей: 3 из 11 · осталось 9 игроков")).toBeTruthy();
    expect(stored().tournament!.log).toHaveLength(3);
  });

  it("plays to the end and shows the champion", () => {
    let t = tournament(5, 2);
    openGrid(t);
    let taps = 0;
    while (!t.champion) {
      const table = t.tables.findIndex((id) => id !== null);
      const m = t.matches[t.tables[table]!];
      tap(t, table, m.a!);
      t = stored().tournament!;
      taps++;
    }
    expect(taps).toBe(4);
    expect(stored().history).toHaveLength(4);
    expect(screen.getByRole("heading", { name: `Чемпион ${playerName(t, t.champion)}` })).toBeTruthy();
    expect(screen.queryAllByRole("article")).toHaveLength(0);
  });

  it("switching language keeps the game and translates the grid", () => {
    const t = tournament(8, 5);
    openGrid(t);
    fireEvent.click(screen.getByRole("button", { name: "Español" }));
    expect(screen.getByRole("heading", { name: "Torneo" })).toBeTruthy();
    expect(screen.getByRole("article", { name: "Mesa 5" })).toBeTruthy();
    expect(within(screen.getByRole("article", { name: "Mesa 5" })).getByText("Libre")).toBeTruthy();
    expect(within(screen.getByRole("article", { name: "Mesa 1" })).getByText("Cuartos de final")).toBeTruthy();
    expect(stored()).toEqual({ tournament: t, history: [], lang: "es" });
  });
});
