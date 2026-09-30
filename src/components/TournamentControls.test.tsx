// @vitest-environment jsdom
// Step 5: results, waiting, table count, Undo, champion, and reloads in each of those states.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTournament } from "../engine/bracket";
import { queue, setTableCount } from "../engine/play";
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
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(START);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const raw = () => localStorage.getItem(STORAGE_KEY);
const stored = (): AppState => JSON.parse(raw()!);
const current = () => stored().tournament!;

function tournament(players: number, tables: number, seed = 1): Tournament {
  return createTournament(names(players), tables, seededRng(seed), new Date(START).toISOString());
}

function openGrid(t: Tournament, history: string[] = [], lang: AppState["lang"] = "ru") {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ tournament: t, history, lang }));
  render(<NextBestApp />);
  fireEvent.click(screen.getByRole("button", { name: lang === "ru" ? "Продолжить турнир" : "Continuar torneo" }));
}

/** Simulates a browser reload: unmount, mount again, press Continue. */
function reload() {
  cleanup();
  render(<NextBestApp />);
  fireEvent.click(screen.getByRole("button", { name: "Продолжить турнир" }));
}

const click = (name: string) => fireEvent.click(screen.getByRole("button", { name }));
const button = (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement;
const tile = (i: number) => screen.getByRole("article", { name: `Стол ${i + 1}` });
const name = (t: Tournament, id: string) => t.players[id].name;

/** Tap the first player of the match on `table` (after the NEW tap guard). */
function tapTable(table: number, side: "a" | "b" = "a") {
  const t = current();
  const m = t.matches[t.tables[table]!];
  vi.setSystemTime(Date.now() + NEW_MATCH_TAP_GUARD_MS + 1);
  fireEvent.click(
    within(tile(table)).getByRole("button", { name: `${name(t, m[side]!)} выигрывает, стол ${table + 1}` }),
  );
}

function more() {
  vi.setSystemTime(Date.now() + 1);
  click("Больше столов");
}

function fewer() {
  vi.setSystemTime(Date.now() + 1);
  click("Меньше столов");
}

const tableCountShown = () =>
  Number(within(screen.getByRole("group", { name: "Количество столов" })).getByText(/^\d+$/).textContent);

const waitingRegion = () => screen.queryByRole("region", { name: "Ждут стол" });
const waitingItems = () =>
  waitingRegion() ? within(waitingRegion()!).getAllByRole("listitem").map((li) => li.textContent) : [];
const expectedWaiting = (t: Tournament) =>
  queue(t)
    .slice(0, 6)
    .map((m) => `${name(t, m.a!)} против ${name(t, m.b!)}`);

const resultsRegion = () => screen.getByRole("region", { name: "Результаты" });
function resultRows() {
  return within(resultsRegion())
    .queryAllByRole("listitem")
    .map((li) => {
      const [what, where] = li.querySelectorAll(":scope > span");
      return {
        winner: what.querySelector("strong")?.textContent,
        loser: what.querySelector("s")?.textContent,
        text: what.textContent,
        where: where.textContent,
      };
    });
}

/** The whole visible game state, to compare before/after Undo and reload. */
function visibleState() {
  const tiles = screen.queryAllByRole("article").map((a) => a.textContent?.replace("НОВЫЙ", ""));
  return { tiles, waiting: waitingItems(), results: resultRows(), champion: screen.queryByText("Чемпион") !== null };
}

// --- results --------------------------------------------------------------------

describe("results panel", () => {
  it("starts with a hint, then lists results newest first with winner, loser, table and round", () => {
    openGrid(tournament(12, 2));
    expect(within(resultsRegion()).getByText("Нажмите на имя победителя за столом.")).toBeTruthy();

    tapTable(0, "a");
    expect(resultRows()).toHaveLength(1); // updates immediately
    tapTable(1, "b");
    tapTable(0, "b");

    const t = current();
    const expected = [...t.log].reverse().map((e) => ({
      winner: name(t, e.winner),
      loser: name(t, e.loser),
      text: `${name(t, e.winner)} выиграл(а), ${name(t, e.loser)} выбыл(а)`,
      where: `Стол ${e.table + 1} · Раунд 1`,
    }));
    expect(resultRows()).toEqual(expected);
    expect(expected.map((r) => r.where)).toEqual(["Стол 1 · Раунд 1", "Стол 2 · Раунд 1", "Стол 1 · Раунд 1"]);
  });

  it("names later rounds", () => {
    openGrid(tournament(8, 4));
    for (const table of [0, 1]) tapTable(table);
    tapTable(0); // the semifinal that started on table 1
    expect(resultRows()[0].where).toBe("Стол 1 · Полуфинал");
    expect(resultRows()[2].where).toBe("Стол 1 · Четвертьфинал");
  });
});

// --- waiting --------------------------------------------------------------------

describe("waiting matches", () => {
  it("appear when every table is busy, in engine order, and are not tappable", () => {
    const t = tournament(20, 3);
    openGrid(t);
    expect(queue(t).length).toBeGreaterThan(0);
    expect(waitingItems()).toEqual(expectedWaiting(t));
    expect(within(waitingRegion()!).queryAllByRole("button")).toHaveLength(0);
  });

  it("move onto a table as soon as it is free", () => {
    const t = tournament(20, 3);
    openGrid(t);
    const first = queue(t)[0];
    tapTable(0);
    const after = current();
    expect(after.tables[0]).toBe(first.id);
    expect(waitingItems()).toEqual(expectedWaiting(after));
    expect(waitingItems()).not.toContain(`${name(t, first.a!)} против ${name(t, first.b!)}`);
  });

  it("the panel is hidden when nothing waits", () => {
    openGrid(tournament(8, 4));
    expect(waitingRegion()).toBeNull();
  });
});

// --- table count ------------------------------------------------------------------

describe("table count", () => {
  it("adding a table with nothing waiting creates a free table and saves it", () => {
    openGrid(tournament(8, 4));
    more();
    expect(tableCountShown()).toBe(5);
    expect(within(tile(4)).getByText("Свободен")).toBeTruthy();
    const r = setTableCount(tournament(8, 4), 5);
    expect(r.ok && stored().tournament).toEqual(r.ok && r.tournament);
    expect(stored().history).toHaveLength(1);
  });

  it("adding a table assigns the next waiting match to it at once", () => {
    const t = tournament(20, 3);
    openGrid(t);
    const first = queue(t)[0];
    more();
    expect(current().tables[3]).toBe(first.id);
    expect(within(tile(3)).getByText("НОВЫЙ")).toBeTruthy();
    expect(within(tile(3)).getAllByRole("button").map((b) => b.textContent)).toEqual([
      name(t, first.a!),
      name(t, first.b!),
    ]);
    expect(waitingItems()).toEqual(expectedWaiting(current()));
  });

  it("goes from 7 to 3 when tables 4–7 are free", () => {
    const t = tournament(6, 7);
    expect(t.tables.slice(3).every((id) => id === null)).toBe(true);
    openGrid(t);
    for (let i = 0; i < 4; i++) fewer();
    expect(tableCountShown()).toBe(3);
    expect(current().tables).toEqual(t.tables.slice(0, 3));
    expect(stored().history).toHaveLength(4);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it('refuses to remove a busy table, explains it, and changes nothing ("Стол 7 ещё играет")', () => {
    const t = tournament(30, 7);
    expect(t.tables.every((id) => id !== null)).toBe(true);
    openGrid(t);
    const before = raw();
    fewer();
    expect(raw()).toBe(before); // byte-for-byte unchanged, no history entry
    expect(tableCountShown()).toBe(7);
    expect(screen.getByRole("status").textContent).toBe(
      "Стол 7 ещё играет. Сначала выберите победителя за этим столом.",
    );
    // The message goes away with the next action.
    tapTable(0);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("stops at the first busy table on the way down", () => {
    const t = tournament(8, 7); // tables 1–4 busy, 5–7 free
    openGrid(t);
    for (let i = 0; i < 3; i++) fewer();
    const before = raw();
    fewer();
    expect(raw()).toBe(before);
    expect(stored().history).toHaveLength(3);
    expect(tableCountShown()).toBe(4);
    expect(screen.getByRole("status").textContent).toContain("Стол 4");
  });

  it("keeps the count between 1 and 16", () => {
    openGrid(tournament(8, 1));
    expect(button("Меньше столов").disabled).toBe(true);
    const before = raw();
    fireEvent.click(button("Меньше столов"));
    expect(raw()).toBe(before);

    cleanup();
    openGrid(tournament(8, 16));
    expect(button("Больше столов").disabled).toBe(true);
    const full = raw();
    fireEvent.click(button("Больше столов"));
    expect(raw()).toBe(full);
    expect(tableCountShown()).toBe(16);
  });
});

// --- undo ----------------------------------------------------------------------------

describe("undo", () => {
  it("is disabled with no history and does nothing", () => {
    openGrid(tournament(12, 2));
    const before = raw();
    expect(button("Отменить последнее действие").disabled).toBe(true);
    fireEvent.click(button("Отменить последнее действие"));
    expect(raw()).toBe(before);
  });

  it("walks back through winners and table changes, restoring everything on screen and in storage", () => {
    openGrid(tournament(20, 3));
    const states: Tournament[] = [current()];
    const screens = [visibleState()];
    const actions = [() => tapTable(0), () => more(), () => tapTable(3, "b"), () => tapTable(1), () => fewer()];
    for (const act of actions) {
      act();
      if (JSON.stringify(current()) === JSON.stringify(states[states.length - 1])) continue;
      states.push(current());
      screens.push(visibleState());
    }
    expect(states.length).toBeGreaterThanOrEqual(5);
    expect(stored().history).toHaveLength(states.length - 1);

    for (let k = states.length - 2; k >= 0; k--) {
      click("Отменить последнее действие");
      expect(current()).toEqual(states[k]); // results, eliminations, tables, count, waiting
      expect(stored().history).toHaveLength(k); // Undo never adds history
      expect(visibleState()).toEqual(screens[k]);
      expect(tableCountShown()).toBe(states[k].tables.length);
      expect(screen.queryByText("НОВЫЙ")).toBeNull();
    }
    expect(button("Отменить последнее действие").disabled).toBe(true);
  });

  it("brings an eliminated player back", () => {
    const t = tournament(12, 2);
    openGrid(t);
    const m = t.matches[t.tables[0]!];
    tapTable(0, "a");
    expect(current().players[m.b!].out).toBe(true);
    click("Отменить последнее действие");
    expect(current().players[m.b!].out).toBe(false);
    expect(within(tile(0)).getAllByRole("button").map((b) => b.textContent)).toEqual([name(t, m.a!), name(t, m.b!)]);
  });

  it("undoes the final: back from the Champion screen to the grid", () => {
    openGrid(tournament(5, 2));
    while (!current().champion) tapTable(current().tables.findIndex((id) => id !== null));
    const champion = current();
    expect(screen.getByText("Чемпион")).toBeTruthy();

    click("Отменить последнее действие");
    expect(current().champion).toBeNull();
    expect(screen.queryByText("Чемпион")).toBeNull();
    expect(screen.getAllByRole("article").length).toBeGreaterThan(0);

    const final = current().matches[`${current().rounds}-0`];
    const table = final.table!;
    tapTable(table, final.a === champion.champion ? "a" : "b");
    expect(current().champion).toBe(champion.champion);
  });
});

// --- champion ---------------------------------------------------------------------------

function playToChampion() {
  while (!current().champion) tapTable(current().tables.findIndex((id) => id !== null));
  return current();
}

describe("champion screen", () => {
  it("shows the champion, a completion summary and the final", () => {
    openGrid(tournament(5, 2));
    const t = playToChampion();
    const final = t.matches[`${t.rounds}-0`];
    expect(t.champion).toBe(final.winner);
    expect(screen.getByRole("heading", { name: `Чемпион ${name(t, t.champion!)}` })).toBeTruthy();
    expect(screen.getByText("Турнир завершён: 5 игроков, 4 матча")).toBeTruthy();
    const finalText = `Финал: ${name(t, final.winner!)} выиграл(а), ${name(t, final.loser!)} выбыл(а)`;
    expect(screen.getByText((_, el) => el?.tagName === "P" && el.textContent === finalText)).toBeTruthy();
    expect(screen.getByText("Турнир завершён")).toBeTruthy(); // header status
    expect(screen.queryByRole("group", { name: "Количество столов" })).toBeNull();
    expect(screen.queryAllByRole("article")).toHaveLength(0);
    expect(resultRows()).toHaveLength(4);
    expect(button("Отменить последнее действие").disabled).toBe(false);
  });

  it("New tournament from the Champion screen clears the tournament and keeps Spanish", () => {
    openGrid(tournament(5, 1), [], "es");
    const tapEs = () => {
      const t = current();
      const table = t.tables.findIndex((id) => id !== null);
      const m = t.matches[t.tables[table]!];
      vi.setSystemTime(Date.now() + NEW_MATCH_TAP_GUARD_MS + 1);
      click(`${name(t, m.a!)} gana, mesa ${table + 1}`);
    };
    while (!current().champion) tapEs();
    expect(screen.getByText("Campeón")).toBeTruthy();
    expect(screen.getByText("Torneo terminado: 5 jugadores, 4 partidos")).toBeTruthy();
    click("Nuevo torneo");
    click("Sí, empezar uno nuevo");
    expect(stored()).toEqual({ tournament: null, history: [], lang: "es" });
    expect(screen.getByRole("textbox", { name: "Jugadores" })).toBeTruthy();
  });
});

// --- reloads -----------------------------------------------------------------------------

describe("reload restores", () => {
  it("an active game with waiting matches and results", () => {
    openGrid(tournament(20, 3));
    tapTable(0);
    tapTable(2, "b");
    const before = { state: visibleState(), raw: raw() };
    reload();
    expect(visibleState()).toEqual(before.state);
    expect(waitingItems().length).toBeGreaterThan(0);
    expect(raw()).toBe(before.raw);
  });

  it("the table count after a change", () => {
    openGrid(tournament(20, 3));
    more();
    more();
    const before = visibleState();
    reload();
    expect(tableCountShown()).toBe(5);
    expect(visibleState()).toEqual(before);
  });

  it("the state after Undo, with the remaining history", () => {
    openGrid(tournament(12, 2));
    tapTable(0);
    tapTable(1);
    click("Отменить последнее действие");
    const before = { state: visibleState(), raw: raw() };
    reload();
    expect(visibleState()).toEqual(before.state);
    expect(stored().history).toHaveLength(1);
    expect(button("Отменить последнее действие").disabled).toBe(false);
  });

  it("the Champion screen", () => {
    openGrid(tournament(6, 2));
    const t = playToChampion();
    reload();
    expect(screen.getByRole("heading", { name: `Чемпион ${name(t, t.champion!)}` })).toBeTruthy();
    expect(resultRows()).toHaveLength(5);
  });
});

// --- language & accessibility ------------------------------------------------------------

describe("Spanish and accessible names", () => {
  it("translates results, Undo and the busy-table message", () => {
    openGrid(tournament(30, 7));
    tapTable(0);
    click("Español");
    const t = current();
    const e = t.log[0];
    expect(screen.getByRole("region", { name: "Resultados" }).textContent).toContain(
      `${name(t, e.winner)} ganó a ${name(t, e.loser)}Mesa 1 · Ronda 1`,
    );
    expect(screen.getByRole("button", { name: "Deshacer la última acción" }).textContent).toBe("Deshacer");
    fireEvent.click(screen.getByRole("button", { name: "Menos mesas" }));
    expect(screen.getByRole("status").textContent).toBe(
      "La mesa 7 todavía está jugando. Primero elige al ganador en esa mesa.",
    );
  });

  it("every control on the game and champion screens has a name", () => {
    openGrid(tournament(5, 2));
    const named = () =>
      screen.getAllByRole("button").forEach((b) => {
        expect((b.getAttribute("aria-label") ?? b.textContent ?? "").trim(), b.outerHTML).not.toBe("");
      });
    named();
    playToChampion();
    named();
  });

  it("the table-count group is named and Undo's name starts with its visible text", () => {
    openGrid(tournament(8, 4));
    const undoButton = button("Отменить последнее действие");
    expect(undoButton.textContent).toBe("Отменить");
    expect(undoButton.getAttribute("aria-label")!.startsWith(undoButton.textContent!)).toBe(true);
    expect(screen.getByRole("group", { name: "Количество столов" })).toBeTruthy();
  });
});
