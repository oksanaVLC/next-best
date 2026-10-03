import { expect, test } from "@playwright/test";
import { expectConsistent, freshPage, startTournament, STORAGE_KEY, stored, tapWinner, tilesText } from "./helpers";

// No player maximum: a 250-player tournament in the real browser, and Undo history that shrinks
// instead of failing when localStorage is nearly full.
const PLAYERS = Array.from({ length: 250 }, (_, i) => `Игрок ${i + 1}`);
const SAVE_FAILED = "Не удалось сохранить турнир на этом устройстве. Не обновляйте страницу.";

test("250 players: play, reload, Undo, and keep saving when storage is full", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "runs once; layout.spec covers phone and zoom");
  test.setTimeout(240_000);
  const problems = await freshPage(page);

  await page.getByRole("textbox", { name: "Игроки" }).fill(PLAYERS.join("\n"));
  await expect(page.getByText("250 игроков", { exact: true })).toBeVisible();
  await startTournament(page, "ru", PLAYERS, 16);
  let state = await stored(page);
  expect(Object.keys(state.tournament!.players)).toHaveLength(250);
  expect(state.tournament!.rounds).toBe(8); // bracket of 256
  await expect(page.getByRole("article")).toHaveCount(16);
  await expect(page.getByText("Сыграно матчей: 0 из 249 · осталось 250 игроков")).toBeVisible();

  // More results than the 50 Undo steps: all of them fit in normal browser storage.
  for (let k = 0; k < 55; k++) await tapWinner(page, "ru", k % 2 ? "b" : "a");
  state = await stored(page);
  expect(state.history).toHaveLength(50);
  await expect(page.getByText(SAVE_FAILED)).toHaveCount(0);

  // Reload keeps everything, and Undo still works afterwards.
  const tilesBefore = await tilesText(page, "ru");
  await page.reload();
  await page.getByRole("button", { name: "Продолжить турнир" }).click();
  expect(await tilesText(page, "ru")).toEqual(tilesBefore);
  await page.getByRole("button", { name: "Отменить последнее действие" }).click();
  await expect.poll(async () => (await stored(page)).tournament!.log.length).toBe(54);
  expectConsistent((await stored(page)).tournament!);

  // Fill the rest of this site's localStorage, as another app on the same computer might.
  const filled = await page.evaluate(() => {
    let chunk = "x".repeat(512 * 1024);
    let n = 0;
    while (chunk.length >= 64) {
      try {
        localStorage.setItem(`filler-${n}`, chunk);
        n++;
      } catch {
        chunk = chunk.slice(0, chunk.length / 2);
      }
    }
    return n;
  });
  expect(filled).toBeGreaterThan(0);

  // The next result still saves: older Undo steps are dropped, never the tournament.
  const before = await stored(page);
  await tapWinner(page, "ru");
  const after = await stored(page);
  expect(after.tournament!.log).toHaveLength(before.tournament!.log.length + 1);
  expect(after.history.length).toBeLessThan(50);
  expect(after.history.at(-1)).toEqual(JSON.stringify(before.tournament)); // newest snapshot kept
  await expect(page.getByText(SAVE_FAILED)).toHaveCount(0);

  // A reload restores that latest result, and the remaining Undo steps work.
  await page.reload();
  await page.getByRole("button", { name: "Продолжить турнир" }).click();
  expect((await stored(page)).tournament).toEqual(after.tournament);
  await page.getByRole("button", { name: "Отменить последнее действие" }).click();
  await expect.poll(async () => (await stored(page)).tournament!.log.length).toBe(before.tournament!.log.length);

  await page.evaluate((key) => {
    for (const k of Object.keys(localStorage)) if (k !== key) localStorage.removeItem(k);
  }, STORAGE_KEY);
  expect(problems).toEqual([]);
});
