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
import { Trophy, Medal, Award, Star, RefreshCw, Globe, Loader2, Database } from "lucide-react";

interface LeaderboardEntry {
  rank: number;
  username: string;
  total: number;
  isYou?: boolean;
  topType?: string;
  streak?: number;
}

type LBPeriod = "all" | "weekly" | "daily";

const RANK_COLORS = ["#FFD700", "#C0C0C0", "#CD7F32"];
const RANK_ICONS = [Trophy, Medal, Award];

// Local fallback leaderboard built around the user's real score
function buildLocalFallback(userSolved: number, username?: string, streak?: number): LeaderboardEntry[] {
  const seed = [
    { username: "MapperPro_CZ", total: userSolved + 412, topType: "surface" },
    { username: "StreetWalker_42", total: userSolved + 287, topType: "building_levels" },
    { username: "OSM_Hero_Brno", total: userSolved + 193, topType: "wheelchair" },
    { username: "Cartographer_Jan", total: userSolved + 145, topType: "opening_hours" },
    { username: "MappingEnthusiast", total: userSolved + 88, topType: "cuisine" },
    { username: "CzechMapper_007", total: userSolved + 44, topType: "surface" },
    { username: "GeoFan_Praha", total: userSolved + 23, topType: "lit" },
    { username: username || "You", total: userSolved, isYou: true, topType: "surface", streak },
    { username: "NewMapper2024", total: Math.max(0, userSolved - 12), topType: "backrest" },
    { username: "OSMbeginner_CZ", total: Math.max(0, userSolved - 28), topType: "cuisine" },
  ];
  return seed
    .sort((a, b) => b.total - a.total)
    .map((e, i) => ({ ...e, rank: i + 1, streak: e.streak ?? Math.max(1, Math.floor(e.total / 20)) }));
}

interface LeaderboardPanelProps {
  solved: SolvedQuest[];
  locale: Locale;
  username?: string;
}

export default function LeaderboardPanel({ solved, locale, username }: LeaderboardPanelProps) {
  const [period, setPeriod] = useState<LBPeriod>("all");
  const [dbEntries, setDbEntries] = useState<LeaderboardEntry[]>([]);
  const [myRank, setMyRank] = useState<number | null>(null);
  const [myDbTotal, setMyDbTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [dbError, setDbError] = useState(false);
  const [lastFetch, setLastFetch] = useState<Record<LBPeriod, number>>({ all: 0, weekly: 0, daily: 0 });

  const localSolved = solved.length;

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

  const fallbackEntries = useMemo(
    () => buildLocalFallback(localSolved, username, streak),
    [localSolved, username, streak]
  );

  const fetchLeaderboard = async (p: LBPeriod, force = false) => {
    if (!force && Date.now() - (lastFetch[p] ?? 0) < 60_000) return;
    setLoading(true);
    setDbError(false);
    try {
      const res = await fetch(`/api/leaderboard?period=${p}&limit=25`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      // Merge "you" into results if authenticated
      const entries: LeaderboardEntry[] = (data.entries ?? []).map(
        (e: { rank: number; username: string; total: number }) => ({
          rank: e.rank,
          username: e.username,
          total: e.total,
          isYou: e.username === username,
        })
      );

      // If user has no DB contributions yet but has local solved, inject them
      if (username && localSolved > 0 && !entries.some((e) => e.isYou)) {
        entries.push({ rank: (data.myRank ?? entries.length + 1), username, total: localSolved, isYou: true });
        entries.sort((a, b) => b.total - a.total).forEach((e, i) => { e.rank = i + 1; });
      }

      setDbEntries(entries);
      setMyRank(data.myRank);
      setMyDbTotal(data.myTotal ?? 0);
      setLastFetch((prev) => ({ ...prev, [p]: Date.now() }));
    } catch (err) {
      console.error("Leaderboard fetch error:", err);
      setDbError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchLeaderboard(period); }, [period]);

  // Show DB entries if available, else fallback
  const displayEntries = dbError || dbEntries.length === 0 ? fallbackEntries : dbEntries;
  const isRealData = !dbError && dbEntries.length > 0;

  const yourRankInDisplay = displayEntries.findIndex((e) => e.isYou) + 1;
  const displayedYouScore = myDbTotal > 0 ? Math.max(myDbTotal, localSolved) : localSolved;

  const topTypeName = (typeId?: string) => {
    if (!typeId) return "";
    const qt = QUEST_TYPES.find((q) => q.id === typeId);
    return qt ? t(locale, "quests", qt.titleKey) : typeId;
  };

  return (
    <ScrollArea className="h-full">
      <div className="p-3 flex flex-col gap-3">

        {/* Your stats card */}
        {(localSolved > 0 || myDbTotal > 0) && (
          <div className="rounded-xl border border-primary/25 bg-primary/5 p-3 flex items-center gap-3">
            <div
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold shadow-sm"
              style={{
                background: yourRankInDisplay <= 3 ? RANK_COLORS[yourRankInDisplay - 1] : "var(--primary)",
                color: yourRankInDisplay <= 3 ? "#111" : "white",
              }}
            >
              #{myRank ?? yourRankInDisplay}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground truncate">
                {username ?? t(locale, "leaderboard", "you")}
              </p>
              <p className="text-xs text-muted-foreground">
                {displayedYouScore} {t(locale, "leaderboard", "solved")}
                {streak > 0 && ` · ${streak}d ${t(locale, "leaderboard", "streak")}`}
              </p>
            </div>
            <div className="flex items-center gap-1 text-primary shrink-0">
              <Star size={13} fill="currentColor" />
              <span className="text-xs font-semibold">{displayedYouScore}</span>
            </div>
          </div>
        )}

        {/* Period tabs */}
        <div className="flex rounded-lg border border-border bg-muted/30 p-0.5 gap-0.5">
          {(["all", "weekly", "daily"] as LBPeriod[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`flex-1 text-xs py-1.5 rounded-md font-medium transition-colors ${
                period === p ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {p === "all"
                ? t(locale, "leaderboard", "allTime")
                : p === "weekly"
                ? t(locale, "leaderboard", "weekly")
                : t(locale, "leaderboard", "daily")}
            </button>
          ))}
        </div>

        {/* Data source badge */}
        <div className="flex items-center gap-2 rounded-md bg-muted/30 border border-border px-2.5 py-1.5">
          {isRealData ? (
            <Database size={10} className="shrink-0 text-primary" />
          ) : (
            <Globe size={10} className="shrink-0 text-muted-foreground" />
          )}
          <span className="text-[10px] text-muted-foreground flex-1">
            {isRealData
              ? locale === "cs" ? "Živá data z databáze GeoComplete" : "Live data from GeoComplete database"
              : locale === "cs" ? "Lokální preview (zatím žádná DB data)" : "Local preview (no DB data yet)"}
          </span>
          <button
            onClick={() => fetchLeaderboard(period, true)}
            disabled={loading}
            className="shrink-0 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            aria-label="Refresh"
          >
            <RefreshCw size={10} className={loading ? "animate-spin" : ""} />
          </button>
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-8 gap-2">
            <Loader2 size={18} className="animate-spin text-primary" />
            <span className="text-sm text-muted-foreground">{t(locale, "leaderboard", "loadingOSM")}</span>
          </div>
        )}

        {/* Entries list */}
        {!loading && (
          <div className="flex flex-col gap-0.5">
            {displayEntries.map((entry, idx) => {
              const isTop3 = idx < 3;
              const RankIcon = isTop3 ? RANK_ICONS[idx] : null;
              return (
                <div
                  key={`${entry.username}-${idx}`}
                  className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 transition-colors ${
                    entry.isYou
                      ? "bg-primary/10 border border-primary/25"
                      : "hover:bg-muted/40 border border-transparent"
                  }`}
                >
                  {/* Rank */}
                  <div className="w-6 shrink-0 flex items-center justify-center">
                    {RankIcon ? (
                      <RankIcon size={14} style={{ color: RANK_COLORS[idx] }} />
                    ) : (
                      <span className="text-[11px] font-mono text-muted-foreground">{idx + 1}</span>
                    )}
                  </div>

                  {/* Avatar */}
                  <Avatar className="h-6 w-6 shrink-0">
                    <AvatarFallback
                      className="text-[9px] font-medium"
                      style={{
                        background: entry.isYou
                          ? "var(--primary)"
                          : `hsl(${((entry.username.charCodeAt(0) * 37) + (entry.username.charCodeAt(1) ?? 0) * 13) % 360} 55% 45%)`,
                        color: "white",
                      }}
                    >
                      {entry.username.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>

                  {/* Name + info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className={`text-xs font-medium truncate ${entry.isYou ? "text-primary" : "text-foreground"}`}>
                        {entry.username}
                        {entry.isYou && (
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
                            color: idx === 0 ? "#b8860b" : idx === 1 ? "#666" : "#8b5e2b",
                          }}
                        >
                          #{idx + 1}
                        </Badge>
                      )}
                    </div>
                    {entry.topType && (
                      <p className="text-[10px] text-muted-foreground truncate">{topTypeName(entry.topType)}</p>
                    )}
                  </div>

                  {/* Score */}
                  <div className="flex flex-col items-end shrink-0">
                    <span className="text-xs font-bold text-foreground">{entry.total.toLocaleString()}</span>
                    {entry.streak != null && (
                      <span className="text-[10px] text-muted-foreground">{entry.streak}d</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Footer */}
        {!loading && displayEntries.length === 0 && (
          <div className="text-center py-8">
            <Trophy size={32} className="mx-auto text-muted-foreground/30 mb-2" />
            <p className="text-sm text-muted-foreground">{t(locale, "leaderboard", "noData")}</p>
            <Button size="sm" variant="outline" className="mt-3 text-xs" onClick={() => fetchLeaderboard(period, true)}>
              {t(locale, "map", "loadNow")}
            </Button>
          </div>
        )}

        <p className="text-[10px] text-center text-muted-foreground pt-1 leading-relaxed">
          {isRealData
            ? locale === "cs"
              ? "Počítají se příspěvky přes GeoComplete. Obnovuje se po každém odeslaném úkolu."
              : "Counts contributions submitted via GeoComplete. Updates after every submitted quest."
            : locale === "cs"
            ? "Dokud nebude DB záznamy, zobrazuje se lokální demo. Vyřešte úkoly a přihlaste se!"
            : "Shows local demo until real DB entries exist. Solve quests while logged in!"}
        </p>
      </div>
    </ScrollArea>
  );
}
