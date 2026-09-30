// Runs in the node environment: this is what Next.js does when it prerenders the page.
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as storage from "../lib/storage";
import NextBestApp from "./NextBestApp";

vi.mock("../lib/storage", { spy: true });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("server render", () => {
  it("renders only the loading shell and never reads saved data", () => {
    // A saved tournament that must stay invisible to the server render.
    const getItem = vi.fn(() => JSON.stringify({ tournament: null, history: [], lang: "es" }));
    const localStorage = { getItem, setItem: vi.fn(), removeItem: vi.fn() };
    vi.stubGlobal("localStorage", localStorage);
    vi.stubGlobal("window", { localStorage });

    const html = renderToString(<NextBestApp />);

    expect(storage.loadState).not.toHaveBeenCalled();
    expect(storage.saveState).not.toHaveBeenCalled();
    expect(getItem).not.toHaveBeenCalled();
    expect(html).toBe('<div class="min-h-dvh bg-mist" aria-busy="true"></div>');
  });
});
