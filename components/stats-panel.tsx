"use client";

import { useMemo } from "react";
import type { SolvedQuest } from "@/lib/store";
import { QUEST_TYPES } from "@/lib/quest-types";
import type { Locale } from "@/lib/i18n";
import { t } from "@/lib/i18n";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import {
  Trophy, TrendingUp, Calendar, Clock, Flame,
  Route, Armchair, Building2, Gauge, UtensilsCrossed,
  Wifi, Lightbulb, Footprints, TrafficCone, Layers,
  Home, Wind, Hand, Accessibility,
} from "lucide-react";

const ICON_MAP: Record<string, React.ElementType> = {
  Route, Armchair, Clock, Accessibility, Building2, Gauge,
  Footprints, TrafficCone, Layers, Home, UtensilsCrossed,
  Wifi, Wind, Lightbulb, Hand,
};

interface StatsPanelProps {
  solved: SolvedQuest[];
  locale: Locale;
}

export default function StatsPanel({ solved, locale }: StatsPanelProps) {
  const stats = useMemo(() => {
    const now = new Date();
    const todayStr = now.toISOString().split("T")[0];
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const today = solved.filter((s) => s.timestamp.startsWith(todayStr)).length;
    const thisWeek = solved.filter((s) => new Date(s.timestamp) >= weekAgo).length;
    const thisMonth = solved.filter((s) => new Date(s.timestamp) >= monthAgo).length;

    // Calculate streak
    let streak = 0;
    const daySet = new Set(solved.map((s) => s.timestamp.split("T")[0]));
    const checkDate = new Date(now);
    while (daySet.has(checkDate.toISOString().split("T")[0])) {
      streak++;
      checkDate.setDate(checkDate.getDate() - 1);
    }

    // By type
    const byType: Record<string, number> = {};
    solved.forEach((s) => {
      byType[s.questTypeId] = (byType[s.questTypeId] || 0) + 1;
    });

    return { today, thisWeek, thisMonth, streak, byType, total: solved.length };
  }, [solved]);

  const maxByType = Math.max(...Object.values(stats.byType), 1);

  return (
    <ScrollArea className="h-full">
      <div className="p-4 flex flex-col gap-4">
        <h3 className="font-semibold text-foreground text-lg flex items-center gap-2">
          <Trophy size={20} className="text-accent" />
          {t(locale, "stats", "title")}
        </h3>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg bg-primary/10 border border-primary/20 p-3 text-center">
            <p className="text-2xl font-bold text-primary">{stats.total}</p>
            <p className="text-xs text-muted-foreground">{t(locale, "stats", "totalSolved")}</p>
          </div>
          <div className="rounded-lg bg-accent/10 border border-accent/20 p-3 text-center">
            <p className="text-2xl font-bold text-accent-foreground flex items-center justify-center gap-1">
              <Flame size={20} className="text-accent" />
              {stats.streak}
            </p>
            <p className="text-xs text-muted-foreground">{t(locale, "stats", "streak")}</p>
          </div>
          <div className="rounded-lg bg-card border border-border p-3 text-center">
            <p className="text-2xl font-bold text-foreground">{stats.today}</p>
            <p className="text-xs text-muted-foreground">{t(locale, "stats", "today")}</p>
          </div>
          <div className="rounded-lg bg-card border border-border p-3 text-center">
            <p className="text-2xl font-bold text-foreground">{stats.thisWeek}</p>
            <p className="text-xs text-muted-foreground">{t(locale, "stats", "thisWeek")}</p>
          </div>
        </div>

        {/* By Type */}
        {Object.keys(stats.byType).length > 0 && (
          <div className="flex flex-col gap-2">
            <h4 className="text-sm font-medium text-foreground flex items-center gap-2">
              <TrendingUp size={14} />
              {t(locale, "stats", "byType")}
            </h4>
            <div className="flex flex-col gap-2">
              {Object.entries(stats.byType)
                .sort(([, a], [, b]) => b - a)
                .map(([typeId, count]) => {
                  const qt = QUEST_TYPES.find((q) => q.id === typeId);
                  if (!qt) return null;
                  const Icon = ICON_MAP[qt.icon] || Route;
                  return (
                    <div key={typeId} className="flex items-center gap-2">
                      <div
                        className="flex h-6 w-6 items-center justify-center rounded"
                        style={{ background: qt.color, color: "white" }}
                      >
                        <Icon size={12} />
                      </div>
                      <span className="text-xs text-foreground flex-1 truncate">
                        {t(locale, "quests", qt.titleKey)}
                      </span>
                      <span className="text-xs font-medium text-foreground w-8 text-right">{count}</span>
                      <div className="w-20">
                        <Progress value={(count / maxByType) * 100} className="h-1.5" />
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        )}

        {/* Recent Activity */}
        {solved.length > 0 && (
          <div className="flex flex-col gap-2">
            <h4 className="text-sm font-medium text-foreground flex items-center gap-2">
              <Calendar size={14} />
              {t(locale, "stats", "recentActivity")}
            </h4>
            <div className="flex flex-col gap-1">
              {solved
                .slice(-10)
                .reverse()
                .map((s, i) => {
                  const qt = QUEST_TYPES.find((q) => q.id === s.questTypeId);
                  return (
                    <div key={i} className="flex items-center gap-2 text-xs p-2 rounded bg-muted/30">
                      <div
                        className="h-2 w-2 rounded-full"
                        style={{ background: qt?.color || "#888" }}
                      />
                      <span className="text-muted-foreground flex-1">
                        {s.tag}={s.value}
                      </span>
                      <span className="text-muted-foreground">
                        {new Date(s.timestamp).toLocaleTimeString(locale === "cs" ? "cs-CZ" : "en-US", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                  );
                })}
            </div>
          </div>
        )}

        {solved.length === 0 && (
          <div className="text-center py-8">
            <Trophy size={48} className="mx-auto text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground">
              {locale === "cs"
                ? "Zatim zadne vyresene questy. Zacnete prispivat!"
                : "No quests solved yet. Start contributing!"}
            </p>
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
