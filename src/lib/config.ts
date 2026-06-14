import type { Page, Rank } from "../types";

export const defaultServerUrl = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8787";
export const appVersion = "0.1.1";
export const githubRepo = "Summer-Neko/DayNeko";
export const serverConfigUrl = "https://raw.githubusercontent.com/Summer-Neko/utils/main/tools/config/daynekoServer.json";
export const defaultDataPath = "";
export const storageKey = "dayneko-state-v6";
export const legacyKeys: string[] = [];
export const pageOrder: Page[] = ["home", "time", "events", "friends", "leaderboard", "settings"];
export const rankScore: Record<Rank, number> = { SSS: 100, S: 88, A: 76, B: 62, C: 45 };
export const ranks: Rank[] = ["SSS", "S", "A", "B", "C"];
export const accentOptions = [
  { name: "影青色", value: "#9fc9c7" },
  { name: "宝石绿", value: "#16b978" },
  { name: "深海蓝", value: "#2563a9" },
  { name: "熔岩橙", value: "#ff6a2a" },
  { name: "流金粉", value: "#c9a5a5" },
  { name: "寒武岩灰", value: "#344456"},
  { name: "钛金属", value: "#aab2ba" },
  { name: "丹霞紫", value: "#b9a0aa" },
  { name: "珍珠白", value: "#dce4ec" }
];
