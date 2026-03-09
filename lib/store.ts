import type { Locale } from "./i18n";

export interface OsmUser {
  id: number;
  display_name: string;
  img: string | null;
  changesets_count: number;
  account_created: string;
}

export interface QuestItem {
  id: number;
  type: string;
  lat: number;
  lon: number;
  tags: Record<string, string>;
  questTypeId: string;
  elementType: "node" | "way" | "relation";
}

export interface OsmNote {
  id: number;
  lat: number;
  lon: number;
  status: "open" | "closed";
  date_created: string;
  comments: OsmNoteComment[];
}

export interface OsmNoteComment {
  date: string;
  uid?: number;
  user?: string;
  action: string;
  text: string;
  html: string;
}

export interface SolvedQuest {
  questTypeId: string;
  elementId: number;
  elementType: string;
  tag: string;
  value: string;
  timestamp: string;
  changesetId?: string;
}

export function getUser(): OsmUser | null {
  if (typeof window === "undefined") return null;
  try {
    const cookie = document.cookie
      .split("; ")
      .find((c) => c.startsWith("osm_user="));
    if (!cookie) return null;
    return JSON.parse(decodeURIComponent(cookie.split("=").slice(1).join("=")));
  } catch {
    return null;
  }
}

export function getLocale(): Locale {
  if (typeof window === "undefined") return "en";
  return (localStorage.getItem("gc_locale") as Locale) || "en";
}

export function setLocale(locale: Locale) {
  localStorage.setItem("gc_locale", locale);
}

export function getSolvedQuests(): SolvedQuest[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem("gc_solved") || "[]");
  } catch {
    return [];
  }
}

export function addSolvedQuest(quest: SolvedQuest) {
  const solved = getSolvedQuests();
  solved.push(quest);
  localStorage.setItem("gc_solved", JSON.stringify(solved));
}

export function getEnabledQuestTypes(): string[] | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = localStorage.getItem("gc_enabled_quests");
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

export function setEnabledQuestTypes(types: string[]) {
  localStorage.setItem("gc_enabled_quests", JSON.stringify(types));
}

export function getTheme(): "light" | "dark" | "system" {
  if (typeof window === "undefined") return "system";
  return (localStorage.getItem("gc_theme") as "light" | "dark" | "system") || "system";
}

export function setThemePreference(theme: "light" | "dark" | "system") {
  localStorage.setItem("gc_theme", theme);
}
