import type { AppState } from "../engine/types";
import es from "../../messages/es.json";
import ru from "../../messages/ru.json";

export type Lang = AppState["lang"];

export const LANGS: readonly Lang[] = ["ru", "es"];

/** Spanish must have every key Russian has (checked by TypeScript and by a test). */
export const messages: Record<Lang, typeof ru> = { ru, es };

/** First supported language in the browser's preference list; Russian otherwise. */
export function detectLang(preferred: readonly string[] | undefined): Lang {
  for (const tag of preferred ?? []) {
    const base = tag.toLowerCase().split("-")[0];
    if (base === "ru" || base === "es") return base;
  }
  return "ru";
}

declare module "use-intl" {
  interface AppConfig {
    Locale: Lang;
    Messages: typeof ru;
  }
}
