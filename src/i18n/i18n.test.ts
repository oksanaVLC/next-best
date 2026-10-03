import { createTranslator } from "use-intl";
import { describe, expect, it } from "vitest";
import { detectLang, LANGS, messages } from "./index";

function keyPaths(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [prefix];
  return Object.entries(value).flatMap(([k, v]) => keyPaths(v, prefix ? `${prefix}.${k}` : k));
}

/** English UI words that must never show up in the Spanish interface (whole words, case-sensitive). */
const ENGLISH_UI_WORDS =
  /\b(Table|Tables|Free|Waiting|Results|Undo|Champion|Start|Players|Player|Continue|Cancel|Round|wins|beat|Tournament|New|Delete|Yes|Back|Error|Loading)\b/;

const PARAMS = { count: 3, min: 5, max: 16, played: 1, total: 11, left: 8, number: 2, table: 2, round: 1, name: "Anna", a: "Anna", b: "Maria", winner: "Anna", loser: "Maria", players: 12, matches: 11, w: (chunks: string) => chunks, l: (chunks: string) => chunks };

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

// --- Step 6: plural forms, placeholders and script checks ---------------------------------

const RU_COUNTS = [0, 1, 2, 4, 5, 11, 21, 22, 25, 101, 111, 112, 121, 122, 249, 250];
/** Russian plural category, written out by hand (not via Intl) so the test is independent. */
function ruForm<T>(n: number, one: T, few: T, many: T): T {
  if (n % 10 === 1 && n % 100 !== 11) return one;
  if (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14)) return few;
  return many;
}

describe("Russian plurals for small and large counts (0–25, 101–122, 249, 250)", () => {
  const t = createTranslator({ locale: "ru", messages: messages.ru });
  const cases: [string, (n: number) => string, (n: number) => string][] = [
    ["common.players", (n) => t("common.players", { count: n }), (n) => `${n} ${ruForm(n, "игрок", "игрока", "игроков")}`],
    ["common.tables", (n) => t("common.tables", { count: n }), (n) => `${n} ${ruForm(n, "стол", "стола", "столов")}`],
    ["setup.countOk", (n) => t("setup.countOk", { count: n }), (n) => `${n} ${ruForm(n, "игрок", "игрока", "игроков")}`],
    [
      "setup.countTooFew",
      (n) => t("setup.countTooFew", { count: n, min: 5 }),
      (n) => `${n} ${ruForm(n, "игрок", "игрока", "игроков")} — добавьте минимум 5`,
    ],
    [
      "setup.duplicates",
      (n) => t("setup.duplicates", { count: n }),
      (n) => `Убрано ${n} ${ruForm(n, "повторяющееся имя", "повторяющихся имени", "повторяющихся имён")}`,
    ],
    [
      "grid.status",
      (n) => t("grid.status", { played: 3, total: 11, left: n }),
      (n) => `Сыграно матчей: 3 из 11 · ${ruForm(n, "остался", "осталось", "осталось")} ${n} ${ruForm(n, "игрок", "игрока", "игроков")}`,
    ],
    ["grid.waitingMore", (n) => t("grid.waitingMore", { count: n }), (n) => `и ещё ${n} ${ruForm(n, "матч", "матча", "матчей")}`],
    [
      "champion.summary",
      (n) => t("champion.summary", { players: n, matches: n }),
      (n) =>
        `Турнир завершён: ${n} ${ruForm(n, "игрок", "игрока", "игроков")}, ${n} ${ruForm(n, "матч", "матча", "матчей")}`,
    ],
  ];
  it.each(cases)("%s", (_, render, expected) => {
    expect(RU_COUNTS.map(render)).toEqual(RU_COUNTS.map(expected));
  });
});

describe("Spanish singular / plural for 0, 1, 2", () => {
  const t = createTranslator({ locale: "es", messages: messages.es });
  const cases: [string, (n: number) => string, string[]][] = [
    ["common.players", (n) => t("common.players", { count: n }), ["0 jugadores", "1 jugador", "2 jugadores"]],
    ["common.tables", (n) => t("common.tables", { count: n }), ["0 mesas", "1 mesa", "2 mesas"]],
    [
      "setup.duplicates",
      (n) => t("setup.duplicates", { count: n }),
      ["Se quitaron 0 nombres repetidos", "Se quitó 1 nombre repetido", "Se quitaron 2 nombres repetidos"],
    ],
    [
      "grid.status",
      (n) => t("grid.status", { played: 3, total: 11, left: n }),
      [
        "Partidos jugados: 3 de 11 · quedan 0 jugadores",
        "Partidos jugados: 3 de 11 · queda 1 jugador",
        "Partidos jugados: 3 de 11 · quedan 2 jugadores",
      ],
    ],
    ["grid.waitingMore", (n) => t("grid.waitingMore", { count: n }), ["y 0 partidos más", "y 1 partido más", "y 2 partidos más"]],
    [
      "champion.summary",
      (n) => t("champion.summary", { players: n, matches: n }),
      [
        "Torneo terminado: 0 jugadores, 0 partidos",
        "Torneo terminado: 1 jugador, 1 partido",
        "Torneo terminado: 2 jugadores, 2 partidos",
      ],
    ],
  ];
  it.each(cases)("%s", (_, render, expected) => {
    expect([0, 1, 2].map(render)).toEqual(expected);
  });
});

describe("placeholders and scripts", () => {
  const leaves = (lang: "ru" | "es") =>
    keyPaths(messages[lang]).map((key) => [key, key.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], messages[lang]) as string] as const);
  const placeholders = (message: string) =>
    [...new Set([...message.matchAll(/\{(\w+)(?=[},])/g), ...message.matchAll(/<(\w+)>/g)].map((m) => m[0]))].sort();

  it("ru and es use the same {variables} and <tags> in every message", () => {
    const es = Object.fromEntries(leaves("es"));
    for (const [key, ru] of leaves("ru")) {
      expect(placeholders(es[key]), key).toEqual(placeholders(ru));
    }
  });

  it("formatted Russian has no Latin text and Spanish has no Cyrillic or English", () => {
    const ruT = createTranslator({ locale: "ru", messages: messages.ru });
    const esT = createTranslator({ locale: "es", messages: messages.es });
    const ruParams = { ...PARAMS, name: "Анна", a: "Анна", b: "Мария", winner: "Анна", loser: "Мария" };
    const brand = new Set(["app.name", "language.ru", "language.es"]); // brand and language names are fixed on purpose
    for (const key of keyPaths(messages.ru).filter((k) => !brand.has(k))) {
      // @ts-expect-error -- iterating over all keys dynamically
      expect(ruT(key, ruParams) as string, `ru:${key}`).not.toMatch(/[A-Za-z]/);
      // @ts-expect-error -- iterating over all keys dynamically
      const es = esT(key, PARAMS) as string;
      expect(es, `es:${key}`).not.toMatch(/[Ѐ-ӿ]/);
      expect(es, `es:${key}`).not.toMatch(ENGLISH_UI_WORDS);
    }
  });
});
