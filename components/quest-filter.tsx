"use client";

import { QUEST_TYPES, QUEST_CATEGORIES } from "@/lib/quest-types";
import type { Locale } from "@/lib/i18n";
import { t } from "@/lib/i18n";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Route, Armchair, Clock, Accessibility, Building2, Gauge,
  Footprints, TrafficCone, Layers, Home, UtensilsCrossed,
  Wifi, Wind, Lightbulb, Hand, Store, Filter,
} from "lucide-react";

const ICON_MAP: Record<string, React.ElementType> = {
  Route, Armchair, Clock, Accessibility, Building2, Gauge,
  Footprints, TrafficCone, Layers, Home, UtensilsCrossed,
  Wifi, Wind, Lightbulb, Hand, Store,
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

export default function QuestFilter({
  enabledTypes,
  onToggleType,
  questCounts,
  locale,
}: QuestFilterProps) {
  const categories = Object.entries(QUEST_CATEGORIES);

  return (
    <ScrollArea className="h-full">
      <div className="p-4 flex flex-col gap-4">
        <h3 className="font-semibold text-foreground text-lg flex items-center gap-2">
          <Filter size={20} className="text-primary" />
          {t(locale, "quests", "categories")}
        </h3>

        {categories.map(([catId, cat]) => {
          const catQuests = QUEST_TYPES.filter((qt) => qt.category === catId);
          const CatIcon = ICON_MAP[cat.icon] || Route;

          return (
            <div key={catId} className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <CatIcon size={16} style={{ color: cat.color }} />
                <span className="text-sm font-medium text-foreground">
                  {CATEGORY_LABELS[catId]?.[locale] || catId}
                </span>
              </div>
              <div className="flex flex-col gap-1 ml-6">
                {catQuests.map((qt) => {
                  const Icon = ICON_MAP[qt.icon] || Route;
                  const enabled = enabledTypes.includes(qt.id);
                  const count = questCounts[qt.id] || 0;

                  return (
                    <div
                      key={qt.id}
                      className="flex items-center gap-2 py-1.5"
                    >
                      <Switch
                        checked={enabled}
                        onCheckedChange={() => onToggleType(qt.id)}
                        className="scale-75"
                      />
                      <div
                        className="flex h-5 w-5 items-center justify-center rounded"
                        style={{ background: qt.color, color: "white" }}
                      >
                        <Icon size={10} />
                      </div>
                      <span className="text-xs text-foreground flex-1">
                        {t(locale, "quests", qt.titleKey)}
                      </span>
                      {count > 0 && (
                        <Badge variant="secondary" className="text-xs px-1.5 py-0 h-5 min-w-[24px] justify-center">
                          {count}
                        </Badge>
                      )}
                    </div>
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
