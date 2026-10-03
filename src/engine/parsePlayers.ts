import { MIN_PLAYERS } from "./types";

export type PlayerCountStatus = "ok" | "tooFew";

export type ParsedPlayers = {
  names: string[]; // clean, unique, in input order
  duplicatesRemoved: number;
  status: PlayerCountStatus;
};

/** Case-insensitive comparison key for a cleaned name. */
export function nameKey(name: string): string {
  return name.toLowerCase();
}

/**
 * Text -> clean unique names.
 * Splits on new lines and commas, trims, collapses inner whitespace, drops empties,
 * removes duplicates case-insensitively (first spelling wins) and counts them.
 */
export function parsePlayers(text: string): ParsedPlayers {
  const names: string[] = [];
  const seen = new Set<string>();
  let duplicatesRemoved = 0;

  for (const raw of text.split(/[\r\n,]/)) {
    const name = raw.replace(/\s+/g, " ").trim();
    if (!name) continue;
    const key = nameKey(name);
    if (seen.has(key)) {
      duplicatesRemoved++;
      continue;
    }
    seen.add(key);
    names.push(name);
  }

  return { names, duplicatesRemoved, status: playerCountStatus(names.length) };
}

export function playerCountStatus(count: number): PlayerCountStatus {
  return count < MIN_PLAYERS ? "tooFew" : "ok";
}
