"use client";

import { useState } from "react";
import type { QuestItem, OsmUser, SolvedQuest } from "@/lib/store";
import { addSolvedQuest } from "@/lib/store";
import { QUEST_TYPES } from "@/lib/quest-types";
import type { Locale } from "@/lib/i18n";
import { t } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Route, Armchair, Clock, Accessibility, Building2, Gauge,
  Footprints, TrafficCone, Layers, Home, UtensilsCrossed,
  Wifi, Wind, Lightbulb, Hand, X, Check, ExternalLink, MapPin,
} from "lucide-react";
import { toast } from "sonner";

const ICON_MAP: Record<string, React.ElementType> = {
  Route, Armchair, Clock, Accessibility, Building2, Gauge,
  Footprints, TrafficCone, Layers, Home, UtensilsCrossed,
  Wifi, Wind, Lightbulb, Hand,
};

interface QuestPanelProps {
  quest: QuestItem;
  locale: Locale;
  user: OsmUser | null;
  onClose: () => void;
  onSolved: () => void;
}

export default function QuestPanel({ quest, locale, user, onClose, onSolved }: QuestPanelProps) {
  const [selectedAnswer, setSelectedAnswer] = useState<string>("");
  const [textAnswer, setTextAnswer] = useState("");
  const [numberAnswer, setNumberAnswer] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const questType = QUEST_TYPES.find((qt) => qt.id === quest.questTypeId);
  if (!questType) return null;

  const IconComp = ICON_MAP[questType.icon] || MapPin;
  const title = t(locale, "quests", questType.titleKey);
  const question = t(locale, "quests", questType.questionKey);

  const getAnswerLabel = (answer: { value: string; labelKey: string }) => {
    if (questType.answersSection) {
      return t(locale, questType.answersSection, answer.labelKey);
    }
    return answer.labelKey;
  };

  const getDisplayName = () => {
    const tags = quest.tags;
    return tags.name || tags["name:en"] || tags["name:cs"] || tags.ref || `${quest.elementType}/${quest.id}`;
  };

  const handleSubmit = async () => {
    let value = "";

    if (questType.answerType === "select") {
      value = selectedAnswer;
    } else if (questType.answerType === "yesno") {
      value = selectedAnswer;
    } else if (questType.answerType === "number") {
      value = numberAnswer;
    } else if (questType.answerType === "text") {
      value = textAnswer;
    }

    if (!value) {
      toast.error(locale === "cs" ? "Vyberte odpoved" : "Please select an answer");
      return;
    }

    if (!user) {
      toast.error(t(locale, "auth", "loginRequired"));
      return;
    }

    setSubmitting(true);

    try {
      const res = await fetch("/api/osm/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          elementType: quest.elementType,
          elementId: quest.id,
          tag: questType.osmTag,
          value,
          comment: `Add ${questType.osmTag}=${value} via GeoComplete`,
        }),
      });

      const data = await res.json();

      if (data.success) {
        const solved: SolvedQuest = {
          questTypeId: quest.questTypeId,
          elementId: quest.id,
          elementType: quest.elementType,
          tag: questType.osmTag,
          value,
          timestamp: new Date().toISOString(),
          changesetId: data.changesetId,
        };
        addSolvedQuest(solved);

        toast.success(t(locale, "quests", "solved"), {
          description: `${questType.osmTag}=${value}`,
          action: data.changesetId ? {
            label: "View",
            onClick: () => window.open(`https://www.openstreetmap.org/changeset/${data.changesetId}`, "_blank"),
          } : undefined,
        });

        onSolved();
      } else {
        toast.error(data.error || "Failed to submit edit");
      }
    } catch (err) {
      toast.error("Network error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 p-4 border-b border-border">
        <div
          className="flex h-10 w-10 items-center justify-center rounded-lg"
          style={{ background: questType.color, color: "white" }}
        >
          <IconComp size={20} />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-foreground truncate">{title}</h3>
          <p className="text-xs text-muted-foreground truncate">{getDisplayName()}</p>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} className="shrink-0">
          <X size={18} />
        </Button>
      </div>

      {/* Question */}
      <div className="p-4 border-b border-border bg-muted/30">
        <p className="text-sm font-medium text-foreground">{question}</p>
        {quest.tags.name && (
          <p className="text-xs text-muted-foreground mt-1">
            <MapPin size={12} className="inline mr-1" />
            {quest.tags.name}
          </p>
        )}
      </div>

      {/* Answers */}
      <div className="flex-1 overflow-y-auto p-4">
        {questType.answerType === "select" && questType.answers && (
          <div className="flex flex-col gap-2">
            {questType.answers.map((answer) => (
              <button
                key={answer.value}
                onClick={() => setSelectedAnswer(answer.value)}
                className={`flex items-center gap-3 rounded-lg border p-3 text-left text-sm transition-all ${
                  selectedAnswer === answer.value
                    ? "border-primary bg-primary/10 text-foreground ring-1 ring-primary"
                    : "border-border bg-card text-foreground hover:border-primary/50 hover:bg-muted/50"
                }`}
              >
                <div
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
                    selectedAnswer === answer.value
                      ? "border-primary bg-primary"
                      : "border-muted-foreground"
                  }`}
                >
                  {selectedAnswer === answer.value && (
                    <Check size={12} className="text-primary-foreground" />
                  )}
                </div>
                <span>{getAnswerLabel(answer)}</span>
              </button>
            ))}
          </div>
        )}

        {questType.answerType === "yesno" && (
          <div className="flex flex-col gap-2">
            {[
              { value: "yes", label: t(locale, "app", "yes") },
              { value: "no", label: t(locale, "app", "no") },
            ].map((option) => (
              <button
                key={option.value}
                onClick={() => setSelectedAnswer(option.value)}
                className={`flex items-center gap-3 rounded-lg border p-4 text-left text-sm font-medium transition-all ${
                  selectedAnswer === option.value
                    ? "border-primary bg-primary/10 text-foreground ring-1 ring-primary"
                    : "border-border bg-card text-foreground hover:border-primary/50"
                }`}
              >
                <div
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 ${
                    selectedAnswer === option.value
                      ? "border-primary bg-primary"
                      : "border-muted-foreground"
                  }`}
                >
                  {selectedAnswer === option.value && (
                    <Check size={14} className="text-primary-foreground" />
                  )}
                </div>
                <span className="text-base">{option.label}</span>
              </button>
            ))}
          </div>
        )}

        {questType.answerType === "number" && (
          <div className="flex flex-col gap-3">
            <Input
              type="number"
              min="1"
              max="200"
              value={numberAnswer}
              onChange={(e) => setNumberAnswer(e.target.value)}
              placeholder={locale === "cs" ? "Zadejte cislo..." : "Enter a number..."}
              className="text-center text-2xl h-14"
            />
            <div className="flex gap-2 flex-wrap">
              {[1, 2, 3, 4, 5, 6, 7, 8, 10, 12].map((n) => (
                <Button
                  key={n}
                  variant={numberAnswer === String(n) ? "default" : "outline"}
                  size="sm"
                  onClick={() => setNumberAnswer(String(n))}
                  className="min-w-[40px]"
                >
                  {n}
                </Button>
              ))}
            </div>
          </div>
        )}

        {questType.answerType === "text" && (
          <div className="flex flex-col gap-3">
            <Input
              value={textAnswer}
              onChange={(e) => setTextAnswer(e.target.value)}
              placeholder={locale === "cs" ? "Zadejte hodnotu..." : "Enter a value..."}
            />
            <p className="text-xs text-muted-foreground">
              {locale === "cs"
                ? "Pro oteviraci hodiny pouzijte format OSM, napr.: Mo-Fr 08:00-17:00; Sa 09:00-13:00"
                : "For opening hours, use OSM format, e.g.: Mo-Fr 08:00-17:00; Sa 09:00-13:00"}
            </p>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-2 border-t border-border p-4 bg-card">
        <Button
          variant="outline"
          className="flex-1"
          onClick={onClose}
        >
          {t(locale, "app", "skip")}
        </Button>
        <Button
          className="flex-1"
          onClick={handleSubmit}
          disabled={submitting || (!selectedAnswer && !textAnswer && !numberAnswer)}
        >
          {submitting ? (
            <span className="flex items-center gap-2">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
              {t(locale, "app", "submit")}
            </span>
          ) : (
            <>
              <Check size={16} className="mr-1" />
              {t(locale, "app", "submit")}
            </>
          )}
        </Button>
      </div>

      {/* OSM Link */}
      <div className="border-t border-border p-2 flex justify-center">
        <a
          href={`https://www.openstreetmap.org/${quest.elementType}/${quest.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1 transition-colors"
        >
          <ExternalLink size={11} />
          {locale === "cs" ? "Zobrazit na OSM" : "View on OSM"}
        </a>
      </div>
    </div>
  );
}
