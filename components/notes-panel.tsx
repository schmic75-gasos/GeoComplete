"use client";

import { useState } from "react";
import type { OsmNote, OsmUser } from "@/lib/store";
import type { Locale } from "@/lib/i18n";
import { t } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { X, MessageSquare, CheckCircle, RotateCcw, Send, MapPin, ExternalLink } from "lucide-react";
import { toast } from "sonner";

interface NotesPanelProps {
  note: OsmNote;
  locale: Locale;
  user: OsmUser | null;
  onClose: () => void;
  onUpdated: () => void;
}

export default function NotesPanel({ note, locale, user, onClose, onUpdated }: NotesPanelProps) {
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleComment = async () => {
    if (!comment.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/osm/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "comment",
          noteId: note.id,
          comment: comment.trim(),
        }),
      });
      const data = await res.json();
      if (data.error) {
        toast.error(data.error);
      } else {
        toast.success(locale === "cs" ? "Komentar pridan" : "Comment added");
        setComment("");
        onUpdated();
      }
    } catch {
      toast.error("Network error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleResolve = async () => {
    if (!user) {
      toast.error(t(locale, "auth", "loginRequired"));
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/osm/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "close",
          noteId: note.id,
          comment: comment.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (data.error) {
        toast.error(data.error);
      } else {
        toast.success(locale === "cs" ? "Poznamka vyresena" : "Note resolved");
        onUpdated();
      }
    } catch {
      toast.error("Network error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleReopen = async () => {
    if (!user) {
      toast.error(t(locale, "auth", "loginRequired"));
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/osm/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reopen",
          noteId: note.id,
          comment: comment.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (data.error) {
        toast.error(data.error);
      } else {
        toast.success(locale === "cs" ? "Poznamka znovu otevrena" : "Note reopened");
        onUpdated();
      }
    } catch {
      toast.error("Network error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 p-4 border-b border-border">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
          <MessageSquare size={20} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-foreground">
              {t(locale, "notes", "title")} #{note.id}
            </h3>
            <Badge variant={note.status === "open" ? "destructive" : "secondary"}>
              {t(locale, "notes", note.status)}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {new Date(note.date_created).toLocaleDateString(locale === "cs" ? "cs-CZ" : "en-US")}
          </p>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} className="shrink-0">
          <X size={18} />
        </Button>
      </div>

      {/* Comments */}
      <ScrollArea className="flex-1">
        <div className="p-4 flex flex-col gap-3">
          {note.comments.map((c, i) => (
            <div
              key={i}
              className={`rounded-lg p-3 text-sm ${
                c.action === "opened"
                  ? "bg-muted border border-border"
                  : c.action === "closed"
                  ? "bg-primary/5 border border-primary/20"
                  : "bg-card border border-border"
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="font-medium text-foreground text-xs">
                  {c.user || t(locale, "notes", "anonymous")}
                </span>
                <span className="text-xs text-muted-foreground">
                  {new Date(c.date).toLocaleDateString(locale === "cs" ? "cs-CZ" : "en-US")}
                </span>
              </div>
              <div
                className="text-muted-foreground text-xs leading-relaxed"
                dangerouslySetInnerHTML={{ __html: c.html || c.text }}
              />
              {c.action !== "commented" && c.action !== "opened" && (
                <Badge variant="outline" className="mt-2 text-xs">
                  {c.action}
                </Badge>
              )}
            </div>
          ))}
        </div>
      </ScrollArea>

      {/* Add comment */}
      <div className="border-t border-border p-4 flex flex-col gap-2">
        <Textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder={t(locale, "notes", "commentPlaceholder")}
          rows={2}
          className="resize-none text-sm"
        />
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={handleComment}
            disabled={submitting || !comment.trim()}
          >
            <Send size={14} className="mr-1" />
            {t(locale, "notes", "comment")}
          </Button>
          {note.status === "open" ? (
            <Button
              size="sm"
              className="flex-1"
              onClick={handleResolve}
              disabled={submitting}
            >
              <CheckCircle size={14} className="mr-1" />
              {t(locale, "notes", "resolve")}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              className="flex-1"
              onClick={handleReopen}
              disabled={submitting}
            >
              <RotateCcw size={14} className="mr-1" />
              {t(locale, "notes", "reopen")}
            </Button>
          )}
        </div>
      </div>

      {/* OSM Link */}
      <div className="border-t border-border p-2 flex justify-center">
        <a
          href={`https://www.openstreetmap.org/note/${note.id}`}
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
