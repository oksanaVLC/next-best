// @vitest-environment jsdom
// Step 6: every screen in Russian and in Spanish, with no text or accessible name in the wrong
// language, plus language switching and persistence.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTranslator } from "use-intl";
import { createTournament } from "../engine/bracket";
import type { AppState, Rng, Tournament } from "../engine/types";
import { messages } from "../i18n";
import { STORAGE_KEY } from "../lib/storage";
import NextBestApp, { NEW_MATCH_TAP_GUARD_MS } from "./NextBestApp";

// --- helpers ----------------------------------------------------------------

type Lang = AppState["lang"];
const START = new Date("2026-03-01T10:00:00.000Z").getTime();

// Player names in the script of each language, so leftovers of the other script stand out.
const RU_NAMES = ["Анна", "Мария", "Пётр", "Иван", "Ольга", "Сергей", "Нина", "Павел", "Жанна", "Юрий", "Вера", "Олег", "Дарья", "Егор", "Зоя", "Кирилл", "Лидия", "Максим", "Надежда", "Роман"];
const ES_NAMES = ["Ana", "María", "Pedro", "Juan", "Lucía", "Sergio", "Nerea", "Pablo", "Juana", "Jorge", "Vera", "Óscar", "Diana", "Elena", "Zoe", "Carlos", "Lidia", "Marcos", "Nadia", "Ramón"];
const NAMES: Record<Lang, string[]> = { ru: RU_NAMES, es: ES_NAMES };

/** English UI words that must never appear in either interface (whole words). */
const ENGLISH = /\b(Table|Tables|Free|Waiting|Results|Undo|Champion|Start|Players|Player|Continue|Cancel|Round|wins|beat|Tournament|New|Delete|Yes|Back|Error|Loading)\b/;

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

const tr = (lang: Lang) => createTranslator({ locale: lang, messages: messages[lang] });
const stored = (): AppState => JSON.parse(localStorage.getItem(STORAGE_KEY)!);
const current = () => stored().tournament!;
const click = (name: string) => fireEvent.click(screen.getByRole("button", { name }));

function tournament(lang: Lang, players: number, tables: number, seed = 1): Tournament {
  return createTournament(NAMES[lang].slice(0, players), tables, seededRng(seed), new Date(START).toISOString());
}

function save(state: AppState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

/** Everything a user can see or hear: visible text plus accessible names of controls and regions. */
function everything(): string {
  // Text node by node, so words from neighbouring elements are not glued together ("Mesa 6Free").
  const texts: string[] = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) texts.push(walker.currentNode.textContent ?? "");
  const labels = [...document.querySelectorAll("[aria-label]")].map((el) => el.getAttribute("aria-label"));
  return [...texts, ...labels].join(" \n ");
}

/**
 * Nothing on screen is in the other language: remove player names, the brand and the language
 * names (always shown in their own language), then look for the other script and English words.
 */
function expectOnlyLanguage(lang: Lang, where: string) {
  let text = everything();
  for (const fixed of [...NAMES.ru, ...NAMES.es].sort((a, b) => b.length - a.length)) text = text.split(fixed).join(" ");
  text = text.split("NextBest").join(" ").split("Русский").join(" ").split("Español").join(" ");
  if (lang === "ru") expect(text, `${where}: Latin text in Russian UI`).not.toMatch(/[A-Za-z]/);
  else expect(text, `${where}: Cyrillic text in Spanish UI`).not.toMatch(/[Ѐ-ӿ]/);
  expect(text, `${where}: English UI word`).not.toMatch(ENGLISH);
}

/** Every button has a non-empty accessible name. */
function expectNamedControls(where: string) {
  for (const b of screen.getAllByRole("button")) {
    expect((b.getAttribute("aria-label") ?? b.textContent ?? "").trim(), `${where}: ${b.outerHTML}`).not.toBe("");
  }
}

function tapFirstBusy(lang: Lang) {
  const t = current();
  const table = t.tables.findIndex((id) => id !== null);
  const m = t.matches[t.tables[table]!];
  vi.setSystemTime(Date.now() + NEW_MATCH_TAP_GUARD_MS + 1);
  click(tr(lang)("grid.winsAt", { name: t.players[m.a!].name, table: table + 1 }));
}

// --- every screen, in each language -------------------------------------------------------

describe.each(["ru", "es"] as const)("%s interface", (lang) => {
  const t = tr(lang);

  it("setup with validation, duplicates and invalid tables", () => {
    save({ tournament: null, history: [], lang });
    render(<NextBestApp />);
    expectOnlyLanguage(lang, "empty setup");
    const names = NAMES[lang];
    fireEvent.change(screen.getByRole("textbox", { name: t("setup.playersLabel") }), {
      target: { value: [names[0], names[1], names[0].toUpperCase(), names[2]].join("\n") },
    });
    fireEvent.change(screen.getByRole("textbox", { name: t("setup.tablesLabel") }), { target: { value: "0" } });
    expect(screen.getByText(t("setup.countTooFew", { count: 3, min: 5 }))).toBeTruthy();
    expect(screen.getByText(t("setup.duplicates", { count: 1 }))).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toBe(t("setup.tablesInvalid", { min: 1, max: 16 }));
    expectOnlyLanguage(lang, "invalid setup");
    expectNamedControls("setup");

    const many = Array.from({ length: 31 }, (_, i) => `${names[i % names.length]} ${i}`);
    fireEvent.change(screen.getByRole("textbox", { name: t("setup.playersLabel") }), { target: { value: many.join("\n") } });
    expect(screen.getByText(t("setup.countTooMany", { count: 31, max: 30 }))).toBeTruthy();
    expectOnlyLanguage(lang, "too many players");
  });

  it("resume, confirm New, grid with waiting/results/busy table, and champion", () => {
    save({ tournament: tournament(lang, 20, 3), history: [], lang });
    render(<NextBestApp />);
    expect(screen.getByRole("heading", { name: t("resume.title") })).toBeTruthy();
    expect(screen.getByText(t("common.played", { played: 0, total: 19 }))).toBeTruthy();
    expectOnlyLanguage(lang, "resume");
    expectNamedControls("resume");

    click(t("common.newTournament"));
    expect(screen.getByRole("heading", { name: t("confirmNew.question") })).toBeTruthy();
    expectOnlyLanguage(lang, "confirm New");
    click(t("confirmNew.cancel"));

    click(t("resume.continue"));
    tapFirstBusy(lang);
    fireEvent.click(screen.getByRole("button", { name: t("setup.moreTables") }));
    fireEvent.click(screen.getByRole("button", { name: t("setup.fewerTables") })); // table 4 is busy: refused
    expect(screen.getByRole("status").textContent).toBe(t("grid.tableBusy", { number: 4 }));
    expect(screen.getByRole("region", { name: t("grid.waitingTitle") })).toBeTruthy();
    expect(screen.getByRole("region", { name: t("grid.resultsTitle") })).toBeTruthy();
    expect(screen.getByRole("button", { name: t("grid.undoLabel") }).textContent).toBe(t("grid.undo"));
    expect(screen.getByRole("group", { name: t("setup.tablesLabel") })).toBeTruthy();
    expectOnlyLanguage(lang, "grid");
    expectNamedControls("grid");

    while (!current().champion) tapFirstBusy(lang);
    expect(screen.getByText(t("champion.title"))).toBeTruthy();
    expect(screen.getByText(t("champion.summary", { players: 20, matches: 19 }))).toBeTruthy();
    expect(screen.getByText(t("grid.finished"))).toBeTruthy();
    expectOnlyLanguage(lang, "champion");
    expectNamedControls("champion");
  });

  it("free tables and the empty results hint", () => {
    save({ tournament: tournament(lang, 8, 6), history: [], lang });
    render(<NextBestApp />);
    click(t("resume.continue"));
    expect(within(screen.getByRole("article", { name: t("grid.table", { number: 6 }) })).getByText(t("grid.free"))).toBeTruthy();
    expect(screen.getByText(t("grid.resultsEmpty"))).toBeTruthy();
    expectOnlyLanguage(lang, "free tables");
  });

  it("recovery and storage problems", () => {
    // Unreadable data: the language cannot be read either, so the browser language decides.
    vi.spyOn(navigator, "languages", "get").mockReturnValue([lang]);
    localStorage.setItem(STORAGE_KEY, "{broken");
    render(<NextBestApp />);
    expect(screen.getByRole("heading", { name: t("recover.title") })).toBeTruthy();
    expect(screen.getByText(t("recover.body"))).toBeTruthy();
    expectOnlyLanguage(lang, "recover");
    cleanup();

    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    render(<NextBestApp />);
    expect(screen.getByRole("status").textContent).toBe(t("storage.unavailable"));
    expectOnlyLanguage(lang, "storage unavailable");
    cleanup();
    vi.restoreAllMocks();
    localStorage.clear(); // remove the unreadable data from the first part
    vi.spyOn(navigator, "languages", "get").mockReturnValue([lang]);

    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    render(<NextBestApp />);
    fireEvent.change(screen.getByRole("textbox", { name: t("setup.playersLabel") }), {
      target: { value: NAMES[lang].slice(0, 5).join("\n") },
    });
    click(t("setup.start"));
    expect(screen.getByRole("status").textContent).toBe(t("storage.saveFailed"));
    expectOnlyLanguage(lang, "save failed");
  });
});

// --- switching and persistence --------------------------------------------------------------

describe("language switching", () => {
  it("RU → ES → RU changes only the interface: tournament, history and names stay the same", () => {
    const mixed = createTournament(["Анна", "Lucía", "Пётр", "José", "Ольга", "Zoë", "Иван", "O'Brien"], 3, seededRng(4), new Date(START).toISOString());
    save({ tournament: mixed, history: [], lang: "ru" });
    render(<NextBestApp />);
    click("Продолжить турнир");
    tapFirstBusy("ru");
    const before = stored();
    const namesOnTables = () => screen.getAllByRole("article").map((a) => within(a).queryAllByRole("button").map((b) => b.textContent));

    const ruNames = namesOnTables();
    click("Español");
    expect(screen.getByRole("heading", { name: "Torneo" })).toBeTruthy();
    expect(namesOnTables()).toEqual(ruNames);
    expect(stored()).toEqual({ ...before, lang: "es" });

    click("Русский");
    expect(screen.getByRole("heading", { name: "Турнир" })).toBeTruthy();
    expect(namesOnTables()).toEqual(ruNames);
    expect(stored()).toEqual(before);
    for (const name of ["Анна", "Lucía", "Пётр", "José", "Ольга", "Zoë", "Иван", "O'Brien"]) {
      expect(Object.values(stored().tournament!.players).map((p) => p.name)).toContain(name);
    }
  });

  it("the chosen language survives a reload and Continue", () => {
    save({ tournament: tournament("es", 12, 3), history: [], lang: "ru" });
    render(<NextBestApp />);
    click("Español");
    cleanup();
    render(<NextBestApp />);
    expect(screen.getByRole("heading", { name: "Hay un torneo guardado" })).toBeTruthy();
    click("Continuar torneo");
    expect(screen.getByRole("heading", { name: "Torneo" })).toBeTruthy();
    expect(document.documentElement.lang).toBe("es");
  });

  it("New tournament keeps the chosen language", () => {
    save({ tournament: tournament("ru", 12, 3), history: [], lang: "es" });
    render(<NextBestApp />);
    click("Nuevo torneo");
    click("Sí, empezar uno nuevo");
    expect(screen.getByRole("heading", { name: "Nuevo torneo" })).toBeTruthy();
    expect(stored().lang).toBe("es");
  });

  it("first visit follows the browser; a saved choice wins afterwards", () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["es-ES", "ru"]);
    render(<NextBestApp />);
    expect(screen.getByRole("heading", { name: "Nuevo torneo" })).toBeTruthy();
    click("Русский");
    cleanup();
    render(<NextBestApp />); // the browser still prefers Spanish
    expect(screen.getByRole("heading", { name: "Новый турнир" })).toBeTruthy();

    cleanup();
    localStorage.clear();
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["en-US", "de"]);
    render(<NextBestApp />);
    expect(screen.getByRole("heading", { name: "Новый турнир" })).toBeTruthy(); // fallback: Russian
  });
});
