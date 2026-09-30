// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTournament } from "../engine/bracket";
import { pickWinner } from "../engine/play";
import type { AppState } from "../engine/types";
import { STORAGE_KEY } from "../lib/storage";
import NextBestApp from "./NextBestApp";

// --- helpers ----------------------------------------------------------------

const NOW = "2026-01-01T12:00:00.000Z";
const names = (n: number) => Array.from({ length: n }, (_, i) => `Player ${i + 1}`);

beforeEach(() => {
  localStorage.clear();
  document.documentElement.lang = "";
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderApp() {
  return render(<NextBestApp />);
}

const namesBox = () => screen.getByRole("textbox", { name: "Игроки" });
const tablesBox = () => screen.getByRole("textbox", { name: "Количество столов" });
const startButton = () => screen.getByRole("button", { name: "Начать турнир" });
const fewer = () => screen.getByRole("button", { name: "Меньше столов" });
const more = () => screen.getByRole("button", { name: "Больше столов" });

function typeNames(text: string) {
  fireEvent.change(namesBox(), { target: { value: text } });
}

function typeTables(text: string) {
  fireEvent.change(tablesBox(), { target: { value: text } });
}

function click(name: string) {
  fireEvent.click(screen.getByRole("button", { name }));
}

function stored(): AppState {
  return JSON.parse(localStorage.getItem(STORAGE_KEY)!);
}

function saveRaw(state: AppState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function savedTournament(): AppState {
  let t = createTournament(names(12), 7, () => 0.5, NOW);
  const m = t.matches[t.tables[0]!];
  t = pickWinner(t, m.id, m.a!, NOW);
  return { tournament: t, history: [], lang: "ru" };
}

// --- setup form ---------------------------------------------------------------

describe("setup form", () => {
  it("starts empty with 4 tables and Start disabled", () => {
    renderApp();
    expect(screen.getByRole("heading", { name: "Новый турнир" })).toBeTruthy();
    expect((namesBox() as HTMLTextAreaElement).value).toBe("");
    expect((tablesBox() as HTMLInputElement).value).toBe("4");
    expect(screen.getByText("0 игроков — добавьте минимум 5")).toBeTruthy();
    expect(namesBox().getAttribute("aria-invalid")).toBe("false");
    expect(startButton().hasAttribute("disabled")).toBe(true);
  });

  it("validates 5–30 players with live counts", () => {
    renderApp();
    const cases: [number, string, boolean][] = [
      [4, "4 игрока — добавьте минимум 5", false],
      [5, "5 игроков", true],
      [21, "21 игрок", true],
      [22, "22 игрока", true],
      [30, "30 игроков", true],
      [31, "31 игрок — максимум 30", false],
    ];
    for (const [count, text, valid] of cases) {
      typeNames(names(count).join("\n"));
      expect(screen.getByText(text)).toBeTruthy();
      expect(startButton().hasAttribute("disabled")).toBe(!valid);
      expect(namesBox().getAttribute("aria-invalid")).toBe(String(!valid));
    }
  });

  it("accepts commas, blank lines and extra spaces through parsePlayers", () => {
    renderApp();
    typeNames("Anna, Maria,\n\n  Sofia ,Peter\n\nIván  ");
    expect(screen.getByText("5 игроков")).toBeTruthy();
    expect(startButton().hasAttribute("disabled")).toBe(false);
  });

  it("reports removed duplicates and counts only unique names", () => {
    renderApp();
    typeNames("Anna\nanna\nMaria\nANNA\nSofia\nPeter\nIván");
    expect(screen.getByText("5 игроков")).toBeTruthy();
    expect(screen.getByText("Убрано 2 повтора")).toBeTruthy();
    typeNames("Anna\nanna\nMaria\nSofia\nPeter");
    expect(screen.getByText("4 игрока — добавьте минимум 5")).toBeTruthy();
    expect(screen.getByText("Убран 1 повтор")).toBeTruthy();
    expect(startButton().hasAttribute("disabled")).toBe(true);
  });

  it("steps tables between 1 and 16 and disables the buttons at the limits", () => {
    renderApp();
    for (let i = 0; i < 3; i++) fireEvent.click(fewer());
    expect((tablesBox() as HTMLInputElement).value).toBe("1");
    expect(fewer().hasAttribute("disabled")).toBe(true);
    for (let i = 0; i < 15; i++) fireEvent.click(more());
    expect((tablesBox() as HTMLInputElement).value).toBe("16");
    expect(more().hasAttribute("disabled")).toBe(true);
    expect(fewer().hasAttribute("disabled")).toBe(false);
  });

  it("accepts a typed table count and blocks Start for invalid ones", () => {
    renderApp();
    typeNames(names(12).join("\n"));
    typeTables("7");
    expect(startButton().hasAttribute("disabled")).toBe(false);
    for (const bad of ["0", "17", "abc", "", "2.5"]) {
      typeTables(bad);
      expect(screen.getByRole("alert").textContent).toBe("Введите число от 1 до 16");
      expect(tablesBox().getAttribute("aria-invalid")).toBe("true");
      expect(startButton().hasAttribute("disabled")).toBe(true);
    }
    typeTables("20");
    fireEvent.click(fewer());
    expect((tablesBox() as HTMLInputElement).value).toBe("16");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(startButton().hasAttribute("disabled")).toBe(false);
  });

  it("Start creates and saves the tournament with the engine", () => {
    renderApp();
    typeNames(names(12).join("\n"));
    typeTables("7");
    fireEvent.click(startButton());

    const state = stored();
    expect(state.lang).toBe("ru");
    expect(state.history).toEqual([]);
    const t = state.tournament!;
    expect(t.version).toBe(1);
    expect(Object.values(t.players).map((p) => p.name)).toEqual(names(12));
    expect(t.tables).toHaveLength(7);
    expect(t.log).toEqual([]);

    expect(screen.getByRole("heading", { name: "Турнир" })).toBeTruthy();
    for (let i = 1; i <= 7; i++) expect(screen.getByRole("heading", { name: `Стол ${i}` })).toBeTruthy();
  });

  it("uses the first spelling of duplicate names", () => {
    renderApp();
    typeNames("Anna\nanna\nMaria\nSofia\nPeter\nIván");
    fireEvent.click(startButton());
    expect(Object.values(stored().tournament!.players).map((p) => p.name)).toEqual([
      "Anna",
      "Maria",
      "Sofia",
      "Peter",
      "Iván",
    ]);
  });
});

// --- saved tournament -----------------------------------------------------------

describe("saved tournament", () => {
  it("offers Continue and New, and Continue keeps the tournament", () => {
    saveRaw(savedTournament());
    const before = localStorage.getItem(STORAGE_KEY);
    renderApp();
    expect(screen.getByRole("heading", { name: "Есть сохранённый турнир" })).toBeTruthy();
    expect(screen.getByText("12 игроков")).toBeTruthy();
    expect(screen.getByText("7 столов")).toBeTruthy();
    expect(screen.getByText("Сыграно матчей: 1 из 11")).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();

    click("Продолжить турнир");
    expect(screen.getByRole("heading", { name: "Турнир" })).toBeTruthy();
    expect(localStorage.getItem(STORAGE_KEY)).toBe(before);
  });

  it("New asks first; Cancel keeps the tournament", () => {
    saveRaw(savedTournament());
    const before = localStorage.getItem(STORAGE_KEY);
    renderApp();
    click("Новый турнир");
    expect(screen.getByRole("heading", { name: "Начать новый турнир? Текущий будет удалён." })).toBeTruthy();
    click("Отмена");
    expect(screen.getByRole("heading", { name: "Есть сохранённый турнир" })).toBeTruthy();
    expect(localStorage.getItem(STORAGE_KEY)).toBe(before);
  });

  it("New + confirm clears the tournament, keeps the language and shows the form", () => {
    saveRaw({ ...savedTournament(), lang: "es" });
    renderApp();
    click("Nuevo torneo");
    click("Sí, empezar uno nuevo");
    expect(screen.getByRole("textbox", { name: "Jugadores" })).toBeTruthy();
    expect(stored()).toEqual({ tournament: null, history: [], lang: "es" });
  });

  it("the grid also leads back to a new tournament", () => {
    renderApp();
    typeNames(names(6).join("\n"));
    fireEvent.click(startButton());
    click("Новый турнир");
    click("Отмена");
    expect(screen.getByRole("heading", { name: "Турнир" })).toBeTruthy();
    click("Новый турнир");
    click("Да, начать новый");
    expect(namesBox()).toBeTruthy();
    expect(stored().tournament).toBeNull();
  });

  it("a saved state without a tournament opens the setup form", () => {
    saveRaw({ tournament: null, history: [], lang: "ru" });
    renderApp();
    expect(namesBox()).toBeTruthy();
  });
});

// --- corrupt data -------------------------------------------------------------

describe("corrupt saved data", () => {
  it("shows the recovery message; New starts over and replaces the bad data", () => {
    localStorage.setItem(STORAGE_KEY, "{not json");
    renderApp();
    expect(screen.getByRole("heading", { name: "Не удалось восстановить турнир" })).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();

    // Switching language does not overwrite the unreadable data.
    click("Español");
    expect(screen.getByRole("heading", { name: "No se pudo recuperar el torneo" })).toBeTruthy();
    expect(localStorage.getItem(STORAGE_KEY)).toBe("{not json");

    click("Nuevo torneo");
    expect(screen.getByRole("textbox", { name: "Jugadores" })).toBeTruthy();
    expect(stored()).toEqual({ tournament: null, history: [], lang: "es" });
  });

  it("treats an unknown version as not restorable", () => {
    const state = savedTournament();
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, tournament: { ...state.tournament, version: 2 } }));
    renderApp();
    expect(screen.getByRole("heading", { name: "Не удалось восстановить турнир" })).toBeTruthy();
  });
});

// --- language -------------------------------------------------------------------

describe("language", () => {
  it("switches to Spanish, saves the choice and remembers it", () => {
    renderApp();
    expect(document.documentElement.lang).toBe("ru");
    expect(screen.getByRole("button", { name: "Русский" }).getAttribute("aria-pressed")).toBe("true");

    click("Español");
    expect(screen.getByRole("heading", { name: "Nuevo torneo" })).toBeTruthy();
    expect(screen.getByText("0 jugadores: añade al menos 5")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Empezar torneo" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Español" }).getAttribute("aria-pressed")).toBe("true");
    expect(document.documentElement.lang).toBe("es");
    expect(stored()).toEqual({ tournament: null, history: [], lang: "es" });

    cleanup();
    renderApp();
    expect(screen.getByRole("heading", { name: "Nuevo torneo" })).toBeTruthy();
  });

  it("keeps typed names and table count when switching", () => {
    renderApp();
    typeNames("Анна\nМария\nПётр");
    typeTables("9");
    click("Español");
    expect((screen.getByRole("textbox", { name: "Jugadores" }) as HTMLTextAreaElement).value).toBe("Анна\nМария\nПётр");
    expect((screen.getByRole("textbox", { name: "Número de mesas" }) as HTMLInputElement).value).toBe("9");
    expect(screen.getByText("3 jugadores: añade al menos 5")).toBeTruthy();
  });

  it("keeps the saved tournament when switching", () => {
    const state = savedTournament();
    saveRaw(state);
    renderApp();
    click("Español");
    expect(screen.getByRole("heading", { name: "Hay un torneo guardado" })).toBeTruthy();
    expect(stored()).toEqual({ ...state, lang: "es" });
  });

  it("defaults to the browser language when nothing is saved", () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["es-ES", "en"]);
    renderApp();
    expect(screen.getByRole("heading", { name: "Nuevo torneo" })).toBeTruthy();
  });
});

// --- storage problems -------------------------------------------------------------

describe("storage problems", () => {
  it("still works without localStorage and warns that nothing is saved", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    renderApp();
    expect(screen.getByRole("status").textContent).toBe(
      "Этот браузер не сохраняет данные. Если обновить страницу, турнир пропадёт.",
    );
    typeNames(names(5).join("\n"));
    fireEvent.click(startButton());
    expect(screen.getByRole("heading", { name: "Турнир" })).toBeTruthy();
  });

  it("warns when saving the new tournament fails", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    renderApp();
    typeNames(names(5).join("\n"));
    fireEvent.click(startButton());
    expect(screen.getByRole("heading", { name: "Турнир" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe(
      "Не удалось сохранить турнир на этом устройстве. Не обновляйте страницу.",
    );
  });
});
