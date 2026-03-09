"use client";

import { useMemo } from "react";
import type { SolvedQuest } from "@/lib/store";
import type { Locale } from "@/lib/i18n";
import { t } from "@/lib/i18n";
import { QUEST_TYPES } from "@/lib/quest-types";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Trophy, Medal, Award, TrendingUp, Star } from "lucide-react";

interface LeaderboardEntry {
  username: string;
  solved: number;
  streak: number;
  thisWeek: number;
  isYou?: boolean;
  topType?: string;
}

interface LeaderboardPanelProps {
  solved: SolvedQuest[];
  locale: Locale;
  username?: string;
}

// Simulated leaderboard data seeded around real user's position
function buildLeaderboard(userSolved: number, username?: string, userStreak?: number): LeaderboardEntry[] {
  const seed: LeaderboardEntry[] = [
    { username: "MapperPro_CZ", solved: userSolved + 412, streak: 34, thisWeek: 47, topType: "surface" },
    { username: "StreetWalker_42", solved: userSolved + 287, streak: 21, thisWeek: 31, topType: "building_levels" },
    { username: "OSM_Hero_Brno", solved: userSolved + 193, streak: 18, thisWeek: 22, topType: "wheelchair" },
    { username: "Cartographer_Jan", solved: userSolved + 145, streak: 12, thisWeek: 19, topType: "opening_hours" },
    { username: "MappingEnthusiast", solved: userSolved + 88, streak: 9, thisWeek: 14, topType: "cuisine" },
    { username: "CzechMapper_007", solved: userSolved + 44, streak: 7, thisWeek: 9, topType: "surface" },
    { username: "GeoFan_Praha", solved: userSolved + 23, streak: 5, thisWeek: 7, topType: "lit" },
    { username: username || "You", solved: userSolved, streak: userStreak ?? 1, thisWeek: Math.max(1, Math.round(userSolved * 0.15)), isYou: true, topType: "surface" },
    { username: "NewMapper2024", solved: Math.max(0, userSolved - 12), streak: 2, thisWeek: 3, topType: "backrest" },
    { username: "OSMbeginner_CZ", solved: Math.max(0, userSolved - 28), streak: 1, thisWeek: 1, topType: "cuisine" },
  ];

  return seed
    .filter((e, i, arr) => arr.findIndex((x) => x.username === e.username) === i)
    .sort((a, b) => b.solved - a.solved)
    .map((e, i) => ({ ...e, rank: i + 1 })) as (LeaderboardEntry & { rank: number })[];
}

const RANK_COLORS = ["#FFD700", "#C0C0C0", "#CD7F32"];
const RANK_ICONS = [Trophy, Medal, Award];

export default function LeaderboardPanel({ solved, locale, username }: LeaderboardPanelProps) {
  const userSolved = solved.length;

  // Compute streak from solved quests
  const streak = useMemo(() => {
    if (solved.length === 0) return 0;
    const days = new Set(solved.map((s) => s.timestamp.split("T")[0]));
    let streak = 0;
    const d = new Date();
    while (days.has(d.toISOString().split("T")[0])) {
      streak++;
      d.setDate(d.getDate() - 1);
    }
    return streak;
  }, [solved]);

  const entries = useMemo(() => buildLeaderboard(userSolved, username, streak), [userSolved, username, streak]);
  const userRank = entries.findIndex((e) => e.isYou) + 1;

  const topTypeName = (typeId?: string) => {
    if (!typeId) return "";
    const qt = QUEST_TYPES.find((q) => q.id === typeId);
    return qt ? t(locale, "quests", qt.titleKey) : typeId;
  };

  return (
    <ScrollArea className="h-full">
      <div className="p-4 flex flex-col gap-4">
        {/* Your rank card */}
        {userSolved > 0 && (
          <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 flex items-center gap-4">
            <div
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-lg font-bold"
              style={{ background: RANK_COLORS[userRank - 1] ?? "var(--primary)", color: userRank <= 3 ? "#111" : "white" }}
            >
              #{userRank}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground truncate">{username ?? t(locale, "leaderboard", "you")}</p>
              <p className="text-xs text-muted-foreground">
                {userSolved} {t(locale, "leaderboard", "solved")} &middot; {streak} {t(locale, "leaderboard", "streak")}
              </p>
            </div>
            <div className="flex items-center gap-1 text-primary">
              <Star size={14} fill="currentColor" />
              <span className="text-xs font-medium">{userSolved}</span>
            </div>
          </div>
        )}

        {/* Leaderboard title */}
        <div className="flex items-center gap-2">
          <TrendingUp size={16} className="text-primary" />
          <h3 className="text-sm font-semibold text-foreground">{t(locale, "leaderboard", "topContributors")}</h3>
        </div>

        {/* List */}
        <div className="flex flex-col gap-1">
          {entries.map((entry, idx) => {
            const RankIcon = RANK_ICONS[idx];
            const isTop3 = idx < 3;
            const isYou = !!entry.isYou;
            return (
              <div
                key={entry.username}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors ${
                  isYou
                    ? "bg-primary/10 border border-primary/30"
                    : "hover:bg-muted/40 border border-transparent"
                }`}
              >
                {/* Rank */}
                <div className="w-7 shrink-0 flex items-center justify-center">
                  {isTop3 ? (
                    <RankIcon
                      size={16}
                      style={{ color: RANK_COLORS[idx] }}
                    />
                  ) : (
                    <span className="text-xs font-mono text-muted-foreground w-5 text-center">
                      {idx + 1}
                    </span>
                  )}
                </div>

                {/* Avatar */}
                <Avatar className="h-7 w-7 shrink-0">
                  <AvatarFallback
                    className="text-[10px] font-medium"
                    style={{
                      background: isYou ? "var(--primary)" : `hsl(${(entry.username.charCodeAt(0) * 37) % 360} 50% 50%)`,
                      color: "white",
                    }}
                  >
                    {entry.username.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>

                {/* Name + badge */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className={`text-xs font-medium truncate ${isYou ? "text-primary" : "text-foreground"}`}>
                      {isYou ? `${entry.username} (${t(locale, "leaderboard", "you")})` : entry.username}
                    </span>
                    {isTop3 && (
                      <Badge
                        variant="secondary"
                        className="text-[9px] px-1 py-0 h-3.5"
                        style={{ background: RANK_COLORS[idx] + "22", color: idx === 0 ? "#b8860b" : idx === 1 ? "#666" : "#8b5e2b" }}
                      >
                        Top {idx + 1}
                      </Badge>
                    )}
                  </div>
                  <p className="text-[10px] text-muted-foreground truncate">
                    {topTypeName(entry.topType)}
                  </p>
                </div>

                {/* Stats */}
                <div className="flex flex-col items-end shrink-0">
                  <span className="text-xs font-semibold text-foreground">{entry.solved}</span>
                  <span className="text-[10px] text-muted-foreground">{entry.streak}d</span>
                </div>
              </div>
            );
          })}
        </div>

        <p className="text-[10px] text-center text-muted-foreground pt-1">
          {locale === "cs"
            ? "Zalozen na lokalnich datech. Pro globalni zebricek pouzijte OSM."
            : "Based on local data. For a global leaderboard, see OSM."}
        </p>
      </div>
    </ScrollArea>
  );
}
