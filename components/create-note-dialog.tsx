"use client";

import { useState } from "react";
import type { Locale } from "@/lib/i18n";
import { t } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { MapPin, Send } from "lucide-react";
import { toast } from "sonner";

interface CreateNoteDialogProps {
  open: boolean;
  lat: number;
  lon: number;
  locale: Locale;
  onClose: () => void;
  onCreated: () => void;
}

export default function CreateNoteDialog({
  open,
  lat,
  lon,
  locale,
  onClose,
  onCreated,
}: CreateNoteDialogProps) {
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleCreate = async () => {
    if (!text.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/osm/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          lat,
          lon,
          text: text.trim(),
        }),
      });
      const data = await res.json();
      if (data.error) {
        toast.error(data.error);
      } else {
        toast.success(locale === "cs" ? "Poznamka vytvorena" : "Note created");
        setText("");
        onCreated();
      }
    } catch {
      toast.error("Network error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MapPin size={18} className="text-primary" />
            {t(locale, "notes", "create")}
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">
            {lat.toFixed(6)}, {lon.toFixed(6)}
          </p>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t(locale, "notes", "placeholder")}
            rows={4}
            className="resize-none"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t(locale, "app", "cancel")}
          </Button>
          <Button onClick={handleCreate} disabled={submitting || !text.trim()}>
            <Send size={14} className="mr-1" />
            {t(locale, "notes", "create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
