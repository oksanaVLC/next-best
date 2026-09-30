import { createTranslator } from "use-intl";
import { describe, expect, it } from "vitest";
import { detectLang, LANGS, messages } from "./index";

function keyPaths(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [prefix];
  return Object.entries(value).flatMap(([k, v]) => keyPaths(v, prefix ? `${prefix}.${k}` : k));
}

const PARAMS = { count: 3, min: 5, max: 30, played: 1, total: 11 };

describe("messages", () => {
  it("ru and es have exactly the same keys", () => {
    expect(keyPaths(messages.es).sort()).toEqual(keyPaths(messages.ru).sort());
  });

  it("every message is valid ICU and non-empty in both languages", () => {
    for (const lang of LANGS) {
      const errors: unknown[] = [];
      const t = createTranslator({ locale: lang, messages: messages[lang], onError: (e) => errors.push(e) });
      for (const key of keyPaths(messages[lang])) {
        // @ts-expect-error -- iterating over all keys dynamically
        const text: string = t(key, PARAMS);
        expect(text.trim(), `${lang}:${key}`).not.toBe("");
        expect(text, `${lang}:${key}`).not.toMatch(/[{}]/);
      }
      expect(errors).toEqual([]);
    }
  });

  it("uses Russian plural forms one / few / many", () => {
    const t = createTranslator({ locale: "ru", messages: messages.ru, namespace: "common" });
    const players = [1, 2, 4, 5, 11, 21, 22, 25, 0].map((count) => t("players", { count }));
    expect(players).toEqual([
      "1 игрок",
      "2 игрока",
      "4 игрока",
      "5 игроков",
      "11 игроков",
      "21 игрок",
      "22 игрока",
      "25 игроков",
      "0 игроков",
    ]);
    expect([1, 2, 5].map((count) => t("tables", { count }))).toEqual(["1 стол", "2 стола", "5 столов"]);
  });

  it("uses Spanish plural forms one / other", () => {
    const t = createTranslator({ locale: "es", messages: messages.es, namespace: "common" });
    expect([1, 2, 0].map((count) => t("players", { count }))).toEqual(["1 jugador", "2 jugadores", "0 jugadores"]);
    expect([1, 7].map((count) => t("tables", { count }))).toEqual(["1 mesa", "7 mesas"]);
  });
});

describe("detectLang", () => {
  it("picks the first supported browser language, Russian otherwise", () => {
    expect(detectLang(["es-ES", "ru"])).toBe("es");
    expect(detectLang(["ES"])).toBe("es");
    expect(detectLang(["en-US", "ru-RU", "es"])).toBe("ru");
    expect(detectLang(["en-US", "de"])).toBe("ru");
    expect(detectLang([])).toBe("ru");
    expect(detectLang(undefined)).toBe("ru");
  });
});
