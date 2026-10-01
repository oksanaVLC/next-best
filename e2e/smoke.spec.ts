import { expect, test } from "@playwright/test";
import { expectConsistent, freshPage, startTournament, stored, tapWinner, tilesText } from "./helpers";

// CLAUDE.md §5 smoke test: 12 players + 7 tables → play to champion → refresh mid-way keeps state.
const PLAYERS = ["Анна", "Мария", "Пётр", "Иван", "Ольга", "Сергей", "Нина", "Павел", "Жанна", "Юрий", "Вера", "Олег"];

test("12 players on 7 tables: a whole tournament with Undo, table changes, reloads and a new tournament", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "the full flow runs once; layout.spec covers phone and zoom");
  const problems = await freshPage(page);

  await startTournament(page, "ru", PLAYERS, 7);
  let t = (await stored(page)).tournament!;
  expect(t.tables).toHaveLength(7);
  const tiles = page.getByRole("article");
  await expect(tiles).toHaveCount(7);
  for (let i = 0; i < 7; i++) {
    if (t.tables[i] === null) await expect(tiles.nth(i)).toContainText("Свободен");
    else await expect(tiles.nth(i).getByRole("button")).toHaveCount(2);
  }

  // Three results: losers out, winners in the right next-round slot, results newest first.
  for (let k = 0; k < 3; k++) {
    const { table, winner, loser, before, after } = await tapWinner(page, "ru", k % 2 ? "b" : "a");
    const m = before.matches[before.tables[table]!];
    const next = after.matches[`${m.round + 1}-${Math.floor(m.position / 2)}`];
    expect(m.position % 2 === 0 ? next.a : next.b).toBe(winner);
    const newest = page.getByRole("region", { name: "Результаты" }).getByRole("listitem").first();
    await expect(newest).toContainText(`${after.players[winner].name} выиграл(а), ${after.players[loser].name} выбыл(а)`);
    await expect(page.getByRole("button", { name: new RegExp(`^${after.players[loser].name} выигрывает`) })).toHaveCount(0);
  }

  // Undo the last result, then keep playing.
  const beforeUndo = await stored(page);
  await page.getByRole("button", { name: "Отменить последнее действие" }).click();
  await expect.poll(async () => (await stored(page)).tournament!.log.length).toBe(2);
  expect((await stored(page)).history).toHaveLength(beforeUndo.history.length - 1);
  await expect(page.getByRole("region", { name: "Результаты" }).getByRole("listitem")).toHaveCount(2);
  await tapWinner(page, "ru");

  // Table count: remove a free table, then add it back.
  await page.getByRole("button", { name: "Меньше столов" }).click();
  await expect.poll(async () => (await stored(page)).tournament!.tables.length).toBe(6);
  await page.getByRole("button", { name: "Больше столов" }).click();
  await expect.poll(async () => (await stored(page)).tournament!.tables.length).toBe(7);

  // Reload in the middle: same tables, same results.
  const tilesBefore = await tilesText(page, "ru");
  const resultsBefore = await page.getByRole("region", { name: "Результаты" }).getByRole("listitem").allInnerTexts();
  await page.reload();
  await page.getByRole("button", { name: "Продолжить турнир" }).click();
  expect(await tilesText(page, "ru")).toEqual(tilesBefore);
  expect(await page.getByRole("region", { name: "Результаты" }).getByRole("listitem").allInnerTexts()).toEqual(resultsBefore);

  // A double click on a name creates exactly one result.
  await page.waitForTimeout(1100);
  t = (await stored(page)).tournament!;
  const table = t.tables.findIndex((id) => id !== null);
  const m = t.matches[t.tables[table]!];
  const { log, history } = { log: t.log.length, history: (await stored(page)).history.length };
  await page.getByRole("button", { name: `${t.players[m.a!].name} выигрывает, стол ${table + 1}` }).dblclick();
  await page.waitForTimeout(300);
  expect((await stored(page)).tournament!.log).toHaveLength(log + 1);
  expect((await stored(page)).history).toHaveLength(history + 1);
  expectConsistent((await stored(page)).tournament!);

  // Keyboard: Enter on a name picks the winner and keeps focus on that table; focus is visible.
  await page.waitForTimeout(1100);
  t = (await stored(page)).tournament!;
  const kTable = t.tables.findIndex((id) => id !== null);
  const km = t.matches[t.tables[kTable]!];
  const nameButton = page.getByRole("button", { name: `${t.players[km.a!].name} выигрывает, стол ${kTable + 1}` });
  await page.getByRole("button", { name: "Отменить последнее действие" }).focus();
  await page.keyboard.press("Shift+Tab"); // keyboard interaction, so :focus-visible applies
  await nameButton.focus();
  expect(await nameButton.evaluate((el) => getComputedStyle(el).outlineWidth)).toBe("4px");
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await stored(page)).tournament!.log.length).toBe(t.log.length + 1);
  await expect(page.getByRole("heading", { name: `Стол ${kTable + 1}` })).toBeFocused();
  // Space works on Undo too, and the language switch works from the keyboard.
  await page.getByRole("button", { name: "Отменить последнее действие" }).focus();
  await page.keyboard.press("Space");
  await expect.poll(async () => (await stored(page)).tournament!.log.length).toBe(t.log.length);
  await page.getByRole("button", { name: "Español" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: "Torneo" })).toBeVisible();
  await page.getByRole("button", { name: "Русский" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: "Турнир" })).toBeVisible();

  // Play to the end: exactly one champion.
  while (!(await stored(page)).tournament!.champion) await tapWinner(page, "ru");
  t = (await stored(page)).tournament!;
  expect(t.log).toHaveLength(PLAYERS.length - 1);
  expectConsistent(t);
  const champion = `Чемпион ${t.players[t.champion!].name}`;
  await expect(page.getByRole("heading", { name: champion })).toBeVisible();

  // Reload on the Champion screen.
  await page.reload();
  await page.getByRole("button", { name: "Продолжить турнир" }).click();
  await expect(page.getByRole("heading", { name: champion })).toBeVisible();

  // New tournament: reset, language kept.
  await page.getByRole("button", { name: "Новый турнир" }).click();
  await page.getByRole("button", { name: "Да, начать новый" }).click();
  await expect(page.getByRole("heading", { name: "Новый турнир" })).toBeVisible();
  expect(await stored(page)).toEqual({ tournament: null, history: [], lang: "ru" });

  expect(problems).toEqual([]);
});
