import { expect, test } from "@playwright/test";
import { expectReadableLayout, freshPage, STORAGE_KEY, startTournament, stored, tapWinner } from "./helpers";

// Every screen, in both languages, on desktop, a 390 px phone and 200 % zoom (see playwright.config.ts).
const SCREENS = {
  ru: {
    locale: "ru-RU",
    long: "Александра-Виктория Константинопольская",
    names: ["Мария", "Пётр", "Иван", "Ольга", "Сергей", "Нина", "Павел", "Жанна", "Юрий", "Вера", "Олег", "Дарья", "Егор", "Зоя", "Кирилл", "Лидия", "Максим", "Надежда", "Роман"],
    newTournament: "Новый турнир",
    yes: "Да, начать новый",
    cancel: "Отмена",
    continue: "Продолжить турнир",
    fewer: "Меньше столов",
    more: "Больше столов",
    champion: "Чемпион",
    recover: "Не удалось восстановить турнир",
    players: "Игроки",
    tables: "Количество столов",
  },
  es: {
    locale: "es-ES",
    long: "María-Guadalupe Fernández de Castro",
    names: ["Ana", "Pedro", "Juan", "Lucía", "Sergio", "Nerea", "Pablo", "Juana", "Jorge", "Vera", "Óscar", "Diana", "Elena", "Zoe", "Carlos", "Lidia", "Marcos", "Nadia", "Ramón"],
    newTournament: "Nuevo torneo",
    yes: "Sí, empezar uno nuevo",
    cancel: "Cancelar",
    continue: "Continuar torneo",
    fewer: "Menos mesas",
    more: "Más mesas",
    champion: "Campeón",
    recover: "No se pudo recuperar el torneo",
    players: "Jugadores",
    tables: "Número de mesas",
  },
} as const;

for (const lang of ["ru", "es"] as const) {
  const s = SCREENS[lang];
  test.describe(`${lang}`, () => {
    test.use({ locale: s.locale });

    test("every screen fits, stays readable and has no console problems", async ({ page }, info) => {
      const problems = await freshPage(page);
      const where = (name: string) => `${info.project.name} / ${lang} / ${name}`;

      // First visit follows the browser language.
      await expect(page.getByRole("heading", { name: s.newTournament })).toBeVisible();

      // Recovery screen.
      await page.evaluate((key) => localStorage.setItem(key, "{broken"), STORAGE_KEY);
      await page.reload();
      await expect(page.getByRole("heading", { name: s.recover })).toBeVisible();
      await expectReadableLayout(page, where("recovery"));
      await page.getByRole("button", { name: s.newTournament }).click();

      // Setup with every validation message showing.
      await page.getByRole("textbox", { name: s.players }).fill([s.long, s.names[0], s.names[0].toUpperCase()].join("\n"));
      await page.getByRole("textbox", { name: s.tables }).fill("0");
      await expectReadableLayout(page, where("setup, invalid"));

      // Tables screen with waiting matches, results, NEW and the busy-table message.
      await startTournament(page, lang, [s.long, ...s.names], 3);
      await tapWinner(page, lang);
      await tapWinner(page, lang);
      await page.getByRole("button", { name: s.more }).click();
      await page.getByRole("button", { name: s.fewer }).click(); // the new table is busy: refused
      await expect(page.getByRole("status")).toBeVisible();
      await expectReadableLayout(page, where("tables"));

      await page.getByRole("button", { name: s.newTournament }).click();
      await expectReadableLayout(page, where("confirm New"));
      await page.getByRole("button", { name: s.cancel }).click();

      // Saved tournament after a reload.
      await page.reload();
      await expectReadableLayout(page, where("resume"));
      await page.getByRole("button", { name: s.continue }).click();

      // Champion, with the long name winning.
      while (!(await stored(page)).tournament!.champion) {
        const t = (await stored(page)).tournament!;
        const longId = Object.entries(t.players).find(([, p]) => p.name === s.long)![0];
        const table = t.tables.findIndex((id) => id !== null);
        await tapWinner(page, lang, t.matches[t.tables[table]!].b === longId ? "b" : "a");
      }
      await expect(page.getByRole("heading", { name: new RegExp(`^${s.champion}`) })).toBeVisible();
      await expectReadableLayout(page, where("champion"));

      await page.getByRole("button", { name: s.newTournament }).click();
      await page.getByRole("button", { name: s.yes }).click();
      expect(await stored(page)).toEqual({ tournament: null, history: [], lang });

      expect(problems).toEqual([]);
    });
  });
}
