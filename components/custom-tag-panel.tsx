"use client";

import { useState } from "react";
import type { QuestItem, OsmUser, SolvedQuest } from "@/lib/store";
import { addSolvedQuest } from "@/lib/store";
import type { Locale } from "@/lib/i18n";
import { t } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X, Plus, Check, Tag, ExternalLink } from "lucide-react";
import { toast } from "sonner";

interface CustomTagPanelProps {
  quest: QuestItem;
  locale: Locale;
  user: OsmUser | null;
  onClose: () => void;
  onSolved: () => void;
}

interface TagRow { key: string; value: string; }

export default function CustomTagPanel({ quest, locale, user, onClose, onSolved }: CustomTagPanelProps) {
  const [tags, setTags] = useState<TagRow[]>([{ key: "", value: "" }]);
  const [submitting, setSubmitting] = useState(false);

  const addRow = () => setTags((prev) => [...prev, { key: "", value: "" }]);
  const removeRow = (i: number) => setTags((prev) => prev.filter((_, idx) => idx !== i));
  const updateRow = (i: number, field: "key" | "value", val: string) => {
    setTags((prev) => prev.map((row, idx) => idx === i ? { ...row, [field]: val } : row));
  };

  const validTags = tags.filter((t) => t.key.trim() && t.value.trim());

  const handleSubmit = async () => {
    if (validTags.length === 0) {
      toast.error(locale === "cs" ? "Zadejte alespon jeden tag" : "Enter at least one tag");
      return;
    }
    if (!user) {
      toast.error(t(locale, "auth", "loginRequired"));
      return;
    }
    setSubmitting(true);
    try {
      // Submit each tag as a separate edit. In a real implementation you'd batch them
      // into one changeset. For now we submit the first tag and include rest in comment.
      const firstTag = validTags[0];
      const comment = validTags.length > 1
        ? `Add tags: ${validTags.map((t) => `${t.key}=${t.value}`).join(", ")} via GeoComplete`
        : `Add ${firstTag.key}=${firstTag.value} via GeoComplete`;

      const res = await fetch("/api/osm/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          elementType: quest.elementType,
          elementId: quest.id,
          tag: firstTag.key,
          value: firstTag.value,
          extraTags: validTags.slice(1).reduce((acc, t) => ({ ...acc, [t.key]: t.value }), {}),
          comment,
        }),
      });

      const data = await res.json();
      if (data.success) {
        validTags.forEach((tag) => {
          const solved: SolvedQuest = {
            questTypeId: "custom_tag",
            elementId: quest.id,
            elementType: quest.elementType,
            tag: tag.key,
            value: tag.value,
            timestamp: new Date().toISOString(),
            changesetId: data.changesetId,
          };
          addSolvedQuest(solved);
        });

        toast.success(t(locale, "quests", "solved"), {
          description: validTags.map((t) => `${t.key}=${t.value}`).join(", "),
          action: data.changesetId ? {
            label: "View",
            onClick: () => window.open(`https://www.openstreetmap.org/changeset/${data.changesetId}`, "_blank"),
          } : undefined,
        });
        onSolved();
      } else {
        toast.error(data.error || "Failed to submit");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setSubmitting(false);
    }
  };

  const getDisplayName = () => {
    const t = quest.tags;
    return t.name || t["name:en"] || t["name:cs"] || t.ref || `${quest.elementType}/${quest.id}`;
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 p-4 border-b border-border">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Tag size={20} />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-foreground">
            {locale === "cs" ? "Vlastni tagy" : "Custom Tags"}
          </h3>
          <p className="text-xs text-muted-foreground truncate">{getDisplayName()}</p>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} className="shrink-0">
          <X size={18} />
        </Button>
      </div>

      {/* Existing tags read-only */}
      {Object.keys(quest.tags).length > 0 && (
        <div className="px-4 py-2 border-b border-border bg-muted/20">
          <p className="text-[10px] font-medium text-muted-foreground mb-1.5 uppercase tracking-wide">
            {locale === "cs" ? "Stavajici tagy" : "Existing tags"}
          </p>
          <div className="flex flex-wrap gap-1">
            {Object.entries(quest.tags).slice(0, 12).map(([k, v]) => (
              <span key={k} className="inline-flex items-center rounded bg-secondary px-1.5 py-0.5 text-[10px] text-secondary-foreground font-mono">
                {k}=<span className="text-primary">{v}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Tag input rows */}
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
        <p className="text-xs text-muted-foreground">
          {locale === "cs"
            ? "Pridejte OSM tagy k tomuto prvku. Pouzijte standarndni klic=hodnota format."
            : "Add OSM tags to this element. Use standard key=value format."}
        </p>

        {tags.map((row, i) => (
          <div key={i} className="flex gap-2 items-center">
            <Input
              placeholder={locale === "cs" ? "klic" : "key"}
              value={row.key}
              onChange={(e) => updateRow(i, "key", e.target.value)}
              className="flex-1 font-mono text-xs h-9"
            />
            <span className="text-muted-foreground text-sm shrink-0">=</span>
            <Input
              placeholder={locale === "cs" ? "hodnota" : "value"}
              value={row.value}
              onChange={(e) => updateRow(i, "value", e.target.value)}
              className="flex-1 font-mono text-xs h-9"
            />
            {tags.length > 1 && (
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive"
                onClick={() => removeRow(i)}
              >
                <X size={14} />
              </Button>
            )}
          </div>
        ))}

        <Button
          variant="outline"
          size="sm"
          onClick={addRow}
          className="w-full text-xs"
          disabled={tags.length >= 8}
        >
          <Plus size={13} className="mr-1" />
          {locale === "cs" ? "Pridat dalsi tag" : "Add another tag"}
        </Button>
      </div>

      {/* Actions */}
      <div className="flex gap-2 border-t border-border p-4 bg-card">
        <Button variant="outline" className="flex-1" onClick={onClose}>
          {t(locale, "app", "cancel")}
        </Button>
        <Button
          className="flex-1"
          onClick={handleSubmit}
          disabled={submitting || validTags.length === 0}
        >
          {submitting ? (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent mr-2" />
          ) : (
            <Check size={16} className="mr-1" />
          )}
          {t(locale, "app", "submit")}
        </Button>
      </div>

      {/* OSM link */}
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
