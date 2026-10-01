import { expect, type Page } from "@playwright/test";

export const STORAGE_KEY = "knockout:v1";

type Player = { name: string; out: boolean };
type Match = { a: string | null; b: string | null; winner: string | null; loser: string | null; round: number; position: number };
export type Tournament = {
  players: Record<string, Player>;
  matches: Record<string, Match>;
  tables: (string | null)[];
  champion: string | null;
  rounds: number;
  log: { winner: string; loser: string; table: number; round: number }[];
};
export type AppState = { tournament: Tournament | null; history: string[]; lang: "ru" | "es" };

const WINS_AT = { ru: (name: string, table: number) => `${name} выигрывает, стол ${table}`, es: (name: string, table: number) => `${name} gana, mesa ${table}` };
const NEW_BADGE = { ru: "НОВЫЙ", es: "NUEVO" };

/** Deterministic Math.random for the Start button (mulberry32), and a clean, error-tracked page. */
export async function freshPage(page: Page, seed = 7): Promise<string[]> {
  const problems: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") problems.push(`${m.type()}: ${m.text()}`);
  });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("requestfailed", (r) => problems.push(`requestfailed: ${r.url()}`));
  await page.addInitScript((s) => {
    let state = s >>> 0;
    Math.random = () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let x = state;
      x = Math.imul(x ^ (x >>> 15), x | 1);
      x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }, seed);
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  return problems;
}

export async function stored(page: Page): Promise<AppState> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), STORAGE_KEY);
}

export async function startTournament(page: Page, lang: "ru" | "es", names: string[], tables: number) {
  await page.getByRole("button", { name: lang === "ru" ? "Русский" : "Español" }).click();
  await page.getByRole("textbox", { name: lang === "ru" ? "Игроки" : "Jugadores" }).fill(names.join("\n"));
  await page.getByRole("textbox", { name: lang === "ru" ? "Количество столов" : "Número de mesas" }).fill(String(tables));
  await page.getByRole("button", { name: lang === "ru" ? "Начать турнир" : "Empezar torneo" }).click();
  await expect(page.getByRole("heading", { level: 1, name: lang === "ru" ? "Турнир" : "Torneo" })).toBeVisible();
}

/**
 * Taps a winner the way the organizer would and checks the result in storage.
 * A table that just received a match ignores taps for 1 s, so prefer tables without the NEW badge.
 */
export async function tapWinner(page: Page, lang: "ru" | "es", side: "a" | "b" = "a") {
  const before = (await stored(page)).tournament!;
  const tiles = page.getByRole("article");
  let table = -1;
  for (let i = 0; i < before.tables.length; i++) {
    if (before.tables[i] !== null && !(await tiles.nth(i).innerText()).includes(NEW_BADGE[lang])) {
      table = i;
      break;
    }
  }
  if (table < 0) {
    await page.waitForTimeout(1100);
    table = before.tables.findIndex((id) => id !== null);
  }
  const m = before.matches[before.tables[table]!];
  const winner = side === "a" ? m.a! : m.b!;
  const loser = side === "a" ? m.b! : m.a!;
  await page.getByRole("button", { name: WINS_AT[lang](before.players[winner].name, table + 1) }).click();
  await expect.poll(async () => (await stored(page)).tournament!.log.length).toBe(before.log.length + 1);
  const after = (await stored(page)).tournament!;
  expect(after.players[loser].out).toBe(true);
  expect(after.players[winner].out).toBe(false);
  expectConsistent(after);
  return { table, winner, loser, before, after };
}

/** No player on two tables, nobody eliminated still playing, and the champion is the only survivor. */
export function expectConsistent(t: Tournament) {
  const onTables = t.tables.flatMap((id) => (id === null ? [] : [t.matches[id].a, t.matches[id].b]));
  expect(new Set(onTables).size).toBe(onTables.length);
  for (const p of onTables) expect(t.players[p!].out).toBe(false);
  const alive = Object.entries(t.players).filter(([, p]) => !p.out);
  if (t.champion) expect(alive.map(([id]) => id)).toEqual([t.champion]);
  expect(alive.length).toBe(Object.keys(t.players).length - t.log.length);
}

/** Visible text of every table tile (without the NEW badge), to compare before/after a reload. */
export async function tilesText(page: Page, lang: "ru" | "es") {
  return (await page.getByRole("article").allInnerTexts()).map((s) => s.replace(NEW_BADGE[lang], "").replace(/\s+/g, " ").trim());
}

/** Layout rules from CLAUDE.md §7, measured in the real browser. */
export async function expectReadableLayout(page: Page, where: string) {
  const r = await page.evaluate(() => {
    const cw = document.documentElement.clientWidth;
    const buttons = [...document.querySelectorAll("button")];
    const texts = [...document.querySelectorAll("body *")].filter(
      (e) => !/^(SCRIPT|STYLE)$/.test(e.tagName) && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim()),
    );
    return {
      overflowX: document.documentElement.scrollWidth > cw,
      outside: buttons.filter((b) => { const x = b.getBoundingClientRect(); return x.left < -0.5 || x.right > cw + 0.5; }).map((b) => b.textContent),
      smallControls: buttons.filter((b) => { const x = b.getBoundingClientRect(); return Math.min(x.width, x.height) < 56; }).map((b) => b.textContent),
      smallNameButtons: [...document.querySelectorAll("article button")].filter((b) => b.getBoundingClientRect().height < 76).map((b) => b.textContent),
      smallText: texts.filter((e) => parseFloat(getComputedStyle(e).fontSize) < 16).map((e) => e.textContent!.slice(0, 20)),
      ellipsis: texts.filter((e) => getComputedStyle(e).textOverflow === "ellipsis").map((e) => e.textContent!.slice(0, 20)),
      clipped: texts.filter((e) => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX !== "visible").map((e) => e.textContent!.slice(0, 20)),
    };
  });
  expect(r, where).toEqual({ overflowX: false, outside: [], smallControls: [], smallNameButtons: [], smallText: [], ellipsis: [], clipped: [] });
}
