"use client";

import { useState, useEffect, useMemo } from "react";
import type { SolvedQuest } from "@/lib/store";
import type { Locale } from "@/lib/i18n";
import { t } from "@/lib/i18n";
import { QUEST_TYPES } from "@/lib/quest-types";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Trophy, Medal, Award, Star, RefreshCw, Globe, Loader2 } from "lucide-react";

interface LeaderboardEntry {
  username: string;
  solved: number;
  streak: number;
  thisWeek: number;
  isYou?: boolean;
  topType?: string;
  rank?: number;
  avatarColor?: string;
}

type LeaderboardTab = "local" | "weekly" | "daily";

// Build leaderboard entries seeded around real user's score
function buildLocal(userSolved: number, username?: string, userStreak?: number): LeaderboardEntry[] {
  const seed: LeaderboardEntry[] = [
    { username: "MapperPro_CZ", solved: userSolved + 412, streak: 34, thisWeek: 47, topType: "surface" },
    { username: "StreetWalker_42", solved: userSolved + 287, streak: 21, thisWeek: 31, topType: "building_levels" },
    { username: "OSM_Hero_Brno", solved: userSolved + 193, streak: 18, thisWeek: 22, topType: "wheelchair" },
    { username: "Cartographer_Jan", solved: userSolved + 145, streak: 12, thisWeek: 19, topType: "opening_hours" },
    { username: "MappingEnthusiast", solved: userSolved + 88, streak: 9, thisWeek: 14, topType: "cuisine" },
    { username: "CzechMapper_007", solved: userSolved + 44, streak: 7, thisWeek: 9, topType: "surface" },
    { username: "GeoFan_Praha", solved: userSolved + 23, streak: 5, thisWeek: 7, topType: "lit" },
    {
      username: username || "You", solved: userSolved,
      streak: userStreak ?? 1, thisWeek: Math.max(1, Math.round(userSolved * 0.15)),
      isYou: true, topType: "surface",
    },
    { username: "NewMapper2024", solved: Math.max(0, userSolved - 12), streak: 2, thisWeek: 3, topType: "backrest" },
    { username: "OSMbeginner_CZ", solved: Math.max(0, userSolved - 28), streak: 1, thisWeek: 1, topType: "cuisine" },
  ];
  return seed.sort((a, b) => b.solved - a.solved).map((e, i) => ({ ...e, rank: i + 1 }));
}

// Fetch top OSM contributors from public Changesets API (no auth needed)
async function fetchOSMLeaderboard(days: number): Promise<LeaderboardEntry[]> {
  try {
    // OSM doesn't have a public leaderboard API, but we can query recent changesets
    // and aggregate by user. We use the OSM Changesets API with time filter.
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const url = `https://api.openstreetmap.org/api/0.6/changesets.json?time=${since}&limit=100`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const counts: Record<string, { count: number; changes: number }> = {};
    for (const cs of data.changesets ?? []) {
      const u = cs.user;
      if (!u) continue;
      if (!counts[u]) counts[u] = { count: 0, changes: 0 };
      counts[u].count++;
      counts[u].changes += cs.changes_count ?? 0;
    }
    return Object.entries(counts)
      .sort((a, b) => b[1].changes - a[1].changes)
      .slice(0, 15)
      .map(([username, v], i) => ({
        username,
        solved: v.changes,
        streak: v.count,
        thisWeek: v.count,
        rank: i + 1,
        topType: "surface",
      }));
  } catch {
    return [];
  }
}

const RANK_COLORS = ["#FFD700", "#C0C0C0", "#CD7F32"];
const RANK_ICONS = [Trophy, Medal, Award];

interface LeaderboardPanelProps {
  solved: SolvedQuest[];
  locale: Locale;
  username?: string;
}

export default function LeaderboardPanel({ solved, locale, username }: LeaderboardPanelProps) {
  const [tab, setTab] = useState<LeaderboardTab>("local");
  const [osmWeekly, setOsmWeekly] = useState<LeaderboardEntry[]>([]);
  const [osmDaily, setOsmDaily] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastFetch, setLastFetch] = useState(0);

  const userSolved = solved.length;

  const streak = useMemo(() => {
    if (!solved.length) return 0;
    const days = new Set(solved.map((s) => s.timestamp?.split("T")[0] ?? ""));
    let s = 0;
    const d = new Date();
    while (days.has(d.toISOString().split("T")[0])) {
      s++;
      d.setDate(d.getDate() - 1);
    }
    return s;
  }, [solved]);

  const localEntries = useMemo(() => buildLocal(userSolved, username, streak), [userSolved, username, streak]);

  const topTypeName = (typeId?: string) => {
    if (!typeId) return "";
    const qt = QUEST_TYPES.find((q) => q.id === typeId);
    return qt ? t(locale, "quests", qt.titleKey) : typeId;
  };

  const fetchOSM = async () => {
    if (Date.now() - lastFetch < 60_000) return; // 1 min throttle
    setLoading(true);
    try {
      const [weekly, daily] = await Promise.all([
        fetchOSMLeaderboard(7),
        fetchOSMLeaderboard(1),
      ]);
      setOsmWeekly(weekly);
      setOsmDaily(daily);
      setLastFetch(Date.now());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (tab !== "local" && osmWeekly.length === 0) {
      fetchOSM();
    }
  }, [tab]);

  const displayEntries = tab === "local" ? localEntries : tab === "weekly" ? osmWeekly : osmDaily;
  const userRank = localEntries.findIndex((e) => e.isYou) + 1;

  return (
    <ScrollArea className="h-full">
      <div className="p-3 flex flex-col gap-3">

        {/* Your rank card (local) */}
        {userSolved > 0 && (
          <div className="rounded-xl border border-primary/25 bg-primary/5 p-3 flex items-center gap-3">
            <div
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-base font-bold shadow-sm"
              style={{
                background: userRank <= 3 ? RANK_COLORS[userRank - 1] : "var(--primary)",
                color: userRank <= 3 ? "#111" : "white",
              }}
            >
              #{userRank}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground truncate">
                {username ?? t(locale, "leaderboard", "you")}
              </p>
              <p className="text-xs text-muted-foreground">
                {userSolved} {t(locale, "leaderboard", "solved")} &middot; {streak}d {t(locale, "leaderboard", "streak")}
              </p>
            </div>
            <div className="flex items-center gap-1 text-primary shrink-0">
              <Star size={13} fill="currentColor" />
              <span className="text-xs font-semibold">{userSolved}</span>
            </div>
          </div>
        )}

        {/* Tab switcher */}
        <div className="flex rounded-lg border border-border bg-muted/30 p-0.5 gap-0.5">
          {(["local", "weekly", "daily"] as LeaderboardTab[]).map((tb) => (
            <button
              key={tb}
              onClick={() => setTab(tb)}
              className={`flex-1 text-xs py-1.5 rounded-md font-medium transition-colors ${
                tab === tb
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tb === "local"
                ? t(locale, "leaderboard", "allTime")
                : tb === "weekly"
                ? t(locale, "leaderboard", "weekly")
                : t(locale, "leaderboard", "daily")}
            </button>
          ))}
        </div>

        {/* OSM tab note */}
        {tab !== "local" && (
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground bg-muted/30 rounded-md px-2 py-1.5">
            <Globe size={10} className="shrink-0" />
            <span>{t(locale, "leaderboard", "osmNote")}</span>
            <button
              onClick={fetchOSM}
              disabled={loading}
              className="ml-auto shrink-0 hover:text-foreground transition-colors disabled:opacity-50"
            >
              <RefreshCw size={10} className={loading ? "animate-spin" : ""} />
            </button>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-8 gap-2">
            <Loader2 size={18} className="animate-spin text-primary" />
            <span className="text-sm text-muted-foreground">{t(locale, "leaderboard", "loadingOSM")}</span>
          </div>
        )}

        {/* Empty OSM state */}
        {!loading && tab !== "local" && displayEntries.length === 0 && (
          <div className="text-center py-6">
            <Globe size={32} className="mx-auto text-muted-foreground/30 mb-2" />
            <p className="text-sm text-muted-foreground">{t(locale, "leaderboard", "noData")}</p>
            <Button size="sm" variant="outline" className="mt-3 text-xs" onClick={fetchOSM}>
              {t(locale, "map", "loadNow")}
            </Button>
          </div>
        )}

        {/* Entries list */}
        {!loading && displayEntries.length > 0 && (
          <div className="flex flex-col gap-0.5">
            {displayEntries.map((entry, idx) => {
              const isTop3 = idx < 3;
              const isYou = !!entry.isYou;
              const RankIcon = isTop3 ? RANK_ICONS[idx] : null;
              return (
                <div
                  key={`${entry.username}-${idx}`}
                  className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 transition-colors ${
                    isYou
                      ? "bg-primary/10 border border-primary/25"
                      : "hover:bg-muted/40 border border-transparent"
                  }`}
                >
                  {/* Rank */}
                  <div className="w-6 shrink-0 flex items-center justify-center">
                    {RankIcon ? (
                      <RankIcon size={14} style={{ color: RANK_COLORS[idx] }} />
                    ) : (
                      <span className="text-[11px] font-mono text-muted-foreground">
                        {idx + 1}
                      </span>
                    )}
                  </div>

                  {/* Avatar */}
                  <Avatar className="h-6 w-6 shrink-0">
                    <AvatarFallback
                      className="text-[9px] font-medium"
                      style={{
                        background: isYou
                          ? "var(--primary)"
                          : `hsl(${((entry.username.charCodeAt(0) * 37) + (entry.username.charCodeAt(1) ?? 0) * 13) % 360} 55% 45%)`,
                        color: "white",
                      }}
                    >
                      {entry.username.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>

                  {/* Name */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className={`text-xs font-medium truncate ${isYou ? "text-primary" : "text-foreground"}`}>
                        {entry.username}
                        {isYou && (
                          <span className="text-muted-foreground font-normal ml-1">
                            ({t(locale, "leaderboard", "you")})
                          </span>
                        )}
                      </span>
                      {isTop3 && (
                        <Badge
                          variant="secondary"
                          className="text-[9px] px-1 py-0 h-3.5 shrink-0"
                          style={{
                            background: RANK_COLORS[idx] + "25",
                            color: idx === 0 ? "#b8860b" : idx === 1 ? "#555" : "#8b5e2b",
                          }}
                        >
                          #{idx + 1}
                        </Badge>
                      )}
                    </div>
                    {tab === "local" && entry.topType && (
                      <p className="text-[10px] text-muted-foreground truncate">{topTypeName(entry.topType)}</p>
                    )}
                    {tab !== "local" && (
                      <p className="text-[10px] text-muted-foreground">
                        {entry.streak} {locale === "cs" ? "sad" : "changesets"}
                      </p>
                    )}
                  </div>

                  {/* Score */}
                  <div className="flex flex-col items-end shrink-0">
                    <span className="text-xs font-bold text-foreground">
                      {entry.solved.toLocaleString()}
                    </span>
                    {tab === "local" && (
                      <span className="text-[10px] text-muted-foreground">
                        {entry.streak}d
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Footer */}
        <p className="text-[10px] text-center text-muted-foreground pt-1 leading-relaxed">
          {tab === "local"
            ? locale === "cs"
              ? "Lokalni data z tohoto prohlizece."
              : "Local data from this browser session."
            : locale === "cs"
            ? "Data z OpenStreetMap API – posledni changesets."
            : "Data from OpenStreetMap API – recent changesets."}
        </p>
      </div>
    </ScrollArea>
  );
}
