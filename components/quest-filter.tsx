"use client";

import { QUEST_TYPES, QUEST_CATEGORIES } from "@/lib/quest-types";
import type { Locale } from "@/lib/i18n";
import { t } from "@/lib/i18n";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  Route, Armchair, Clock, Accessibility, Building2, Gauge,
  Footprints, TrafficCone, Layers, Home, UtensilsCrossed,
  Wifi, Wind, Lightbulb, Hand, Filter, ArrowLeftRight,
  MoveRight, Bike, Grip, PersonStanding, Leaf, TreePine,
  Banknote, KeyRound, Phone, Globe, Users, ArrowUp, Umbrella,
  Tag, Trash2, Store,
} from "lucide-react";

const ICON_MAP: Record<string, React.ElementType> = {
  Route, Armchair, Clock, Accessibility, Building2, Gauge,
  Footprints, TrafficCone, Layers, Home, UtensilsCrossed,
  Wifi, Wind, Lightbulb, Hand, Filter, ArrowLeftRight,
  MoveRight, Bike, Grip, PersonStanding, Leaf, TreePine,
  Banknote, KeyRound, Phone, Globe, Users, ArrowUp, Umbrella,
  Tag, Trash2, Store,
};

const CATEGORY_LABELS: Record<string, Record<string, string>> = {
  roads: { en: "Roads & Paths", cs: "Silnice a cesty" },
  buildings: { en: "Buildings", cs: "Budovy" },
  amenities: { en: "Amenities & Shops", cs: "Vybaveni a obchody" },
  accessibility: { en: "Accessibility", cs: "Pristupnost" },
};

interface QuestFilterProps {
  enabledTypes: string[];
  onToggleType: (typeId: string) => void;
  questCounts: Record<string, number>;
  locale: Locale;
}

export default function QuestFilter({ enabledTypes, onToggleType, questCounts, locale }: QuestFilterProps) {
  const categories = Object.entries(QUEST_CATEGORIES);

  const totalEnabled = enabledTypes.length;
  const totalAll = QUEST_TYPES.length;

  return (
    <ScrollArea className="h-full">
      <div className="p-3 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-foreground text-sm flex items-center gap-2">
            <Filter size={16} className="text-primary" />
            {t(locale, "quests", "categories")}
          </h3>
          <span className="text-xs text-muted-foreground">{totalEnabled}/{totalAll}</span>
        </div>

        {categories.map(([catId, cat]) => {
          const catQuests = QUEST_TYPES.filter((qt) => qt.category === catId);
          const CatIcon = ICON_MAP[cat.icon] || Route;
          const allEnabled = catQuests.every((qt) => enabledTypes.includes(qt.id));

          return (
            <div key={catId} className="flex flex-col gap-1.5">
              {/* Category header with toggle-all */}
              <div className="flex items-center gap-2">
                <CatIcon size={14} style={{ color: cat.color }} />
                <span className="text-xs font-semibold text-foreground flex-1">
                  {CATEGORY_LABELS[catId]?.[locale] || catId}
                </span>
                <button
                  onClick={() => {
                    catQuests.forEach((qt) => {
                      if (allEnabled ? enabledTypes.includes(qt.id) : !enabledTypes.includes(qt.id)) {
                        onToggleType(qt.id);
                      }
                    });
                  }}
                  className="text-[10px] text-muted-foreground hover:text-primary transition-colors px-1"
                >
                  {allEnabled ? (locale === "cs" ? "Vypnout vse" : "Disable all") : (locale === "cs" ? "Zapnout vse" : "Enable all")}
                </button>
              </div>

              {/* Quest type rows */}
              <div className="flex flex-col gap-0.5 ml-4">
                {catQuests.map((qt) => {
                  const Icon = ICON_MAP[qt.icon] || Route;
                  const enabled = enabledTypes.includes(qt.id);
                  const count = questCounts[qt.id] || 0;

                  return (
                    <button
                      key={qt.id}
                      onClick={() => onToggleType(qt.id)}
                      className={`flex items-center gap-2.5 w-full px-2 py-1.5 rounded-md text-left transition-colors ${
                        enabled ? "hover:bg-muted/50" : "opacity-50 hover:opacity-70 hover:bg-muted/30"
                      }`}
                    >
                      {/* Toggle indicator */}
                      <div
                        className={`relative inline-flex h-4 w-7 shrink-0 rounded-full border transition-colors ${
                          enabled ? "border-transparent" : "border-muted-foreground/30 bg-muted-foreground/10"
                        }`}
                        style={{ background: enabled ? qt.color : undefined }}
                      >
                        <span
                          className={`inline-block h-3 w-3 rounded-full bg-white shadow-sm transition-transform mt-0.5 ${
                            enabled ? "translate-x-3.5" : "translate-x-0.5"
                          }`}
                        />
                      </div>
                      <div
                        className="flex h-5 w-5 shrink-0 items-center justify-center rounded"
                        style={{ background: enabled ? qt.color : "var(--muted)", color: enabled ? "white" : "var(--muted-foreground)" }}
                      >
                        <Icon size={10} />
                      </div>
                      <span className="text-xs text-foreground flex-1 text-left truncate">
                        {t(locale, "quests", qt.titleKey)}
                      </span>
                      {count > 0 && (
                        <Badge variant="secondary" className="text-[10px] px-1 py-0 h-4 min-w-[20px] justify-center shrink-0">
                          {count}
                        </Badge>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </ScrollArea>
  );
}
