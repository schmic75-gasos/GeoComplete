"use client";

import { useState, useEffect } from "react";
import type { Locale } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, Clock } from "lucide-react";

// OSM day codes in order
const DAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"] as const;
type Day = (typeof DAYS)[number];

interface Period {
  days: Day[];
  open: string;   // "HH:MM"
  close: string;  // "HH:MM" | "24:00"
  closed: boolean;
}

interface OpeningHoursEditorProps {
  value: string;
  onChange: (osmValue: string) => void;
  locale: Locale;
}

const DAY_LABELS: Record<Day, Record<Locale, string>> = {
  Mo: { en: "Mon", cs: "Po" },
  Tu: { en: "Tue", cs: "Út" },
  We: { en: "Wed", cs: "St" },
  Th: { en: "Thu", cs: "Čt" },
  Fr: { en: "Fri", cs: "Pá" },
  Sa: { en: "Sat", cs: "So" },
  Su: { en: "Sun", cs: "Ne" },
};

const HOUR_OPTIONS: string[] = [];
for (let h = 0; h <= 23; h++) {
  HOUR_OPTIONS.push(`${String(h).padStart(2, "0")}:00`);
  HOUR_OPTIONS.push(`${String(h).padStart(2, "0")}:30`);
}
HOUR_OPTIONS.push("24:00");

// Convert periods array to OSM string
function toOsmString(periods: Period[], always: boolean): string {
  if (always) return "24/7";
  if (periods.length === 0) return "";

  return periods
    .map((p) => {
      if (p.days.length === 0) return null;

      // Compress consecutive days: [Mo,Tu,We,Th,Fr] -> "Mo-Fr", [Mo,We] -> "Mo,We"
      const dayStr = compressDays(p.days);

      if (p.closed) return `${dayStr} off`;
      return `${dayStr} ${p.open}-${p.close}`;
    })
    .filter(Boolean)
    .join("; ");
}

function compressDays(days: Day[]): string {
  if (days.length === 0) return "";
  if (days.length === 7) return "Mo-Su";

  // Sort by index
  const sorted = [...days].sort((a, b) => DAYS.indexOf(a) - DAYS.indexOf(b));

  // Find consecutive runs
  const runs: Day[][] = [];
  let current: Day[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    if (DAYS.indexOf(sorted[i]) === DAYS.indexOf(sorted[i - 1]) + 1) {
      current.push(sorted[i]);
    } else {
      runs.push(current);
      current = [sorted[i]];
    }
  }
  runs.push(current);

  return runs
    .map((run) => (run.length >= 3 ? `${run[0]}-${run[run.length - 1]}` : run.join(",")))
    .join(",");
}

// Parse simple OSM string back to periods (best-effort for common formats)
function fromOsmString(value: string): { always: boolean; periods: Period[] } {
  if (!value || value.trim() === "") return { always: false, periods: [defaultPeriod()] };
  if (value.trim() === "24/7") return { always: true, periods: [] };

  const parts = value.split(";").map((s) => s.trim()).filter(Boolean);
  const periods: Period[] = [];

  for (const part of parts) {
    // Try: "Mo-Fr 09:00-17:00" or "Sa 09:00-13:00" or "Su off"
    const m = part.match(/^([A-Za-z,\-]+)\s+(?:(off)|(\d{2}:\d{2})-(\d{2}:\d{2}))$/);
    if (!m) continue;
    const dayPart = m[1];
    const isClosed = !!m[2];
    const open = m[3] || "09:00";
    const close = m[4] || "17:00";

    const days = parseDayRange(dayPart);
    periods.push({ days, open, close, closed: isClosed });
  }

  return { always: false, periods: periods.length > 0 ? periods : [defaultPeriod()] };
}

function parseDayRange(dayStr: string): Day[] {
  const result: Day[] = [];
  for (const chunk of dayStr.split(",")) {
    if (chunk.includes("-")) {
      const [start, end] = chunk.split("-") as [Day, Day];
      const si = DAYS.indexOf(start);
      const ei = DAYS.indexOf(end);
      if (si !== -1 && ei !== -1) {
        for (let i = si; i <= ei; i++) result.push(DAYS[i]);
      }
    } else {
      const d = chunk as Day;
      if (DAYS.includes(d)) result.push(d);
    }
  }
  return [...new Set(result)];
}

function defaultPeriod(): Period {
  return { days: ["Mo", "Tu", "We", "Th", "Fr"], open: "09:00", close: "17:00", closed: false };
}

export default function OpeningHoursEditor({ value, onChange, locale }: OpeningHoursEditorProps) {
  const parsed = fromOsmString(value);
  const [always, setAlways] = useState(parsed.always);
  const [periods, setPeriods] = useState<Period[]>(parsed.periods.length > 0 ? parsed.periods : [defaultPeriod()]);

  // Sync to parent whenever state changes
  useEffect(() => {
    onChange(toOsmString(periods, always));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periods, always]);

  const osmPreview = toOsmString(periods, always);

  const toggleDay = (idx: number, day: Day) => {
    setPeriods((prev) => {
      const next = [...prev];
      const p = { ...next[idx] };
      p.days = p.days.includes(day) ? p.days.filter((d) => d !== day) : [...p.days, day];
      next[idx] = p;
      return next;
    });
  };

  const updatePeriod = (idx: number, field: "open" | "close", val: string) => {
    setPeriods((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: val };
      return next;
    });
  };

  const toggleClosed = (idx: number) => {
    setPeriods((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], closed: !next[idx].closed };
      return next;
    });
  };

  const addPeriod = () => {
    setPeriods((prev) => [...prev, { days: ["Sa", "Su"], open: "10:00", close: "16:00", closed: false }]);
  };

  const removePeriod = (idx: number) => {
    setPeriods((prev) => prev.filter((_, i) => i !== idx));
  };

  const lbl = locale === "cs";

  return (
    <div className="flex flex-col gap-3">
      {/* Always open toggle */}
      <label className="flex items-center gap-2.5 cursor-pointer select-none">
        <button
          type="button"
          role="switch"
          aria-checked={always}
          onClick={() => setAlways((v) => !v)}
          className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors ${always ? "bg-primary" : "bg-muted-foreground/30"}`}
        >
          <span className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${always ? "translate-x-4" : "translate-x-0"}`} />
        </button>
        <span className="text-sm text-foreground">{lbl ? "Vždy otevřeno (24/7)" : "Always open (24/7)"}</span>
      </label>

      {!always && (
        <>
          {periods.map((period, idx) => (
            <div key={idx} className="rounded-lg border border-border bg-muted/30 p-3 flex flex-col gap-2.5">
              {/* Day selector */}
              <div className="flex items-center gap-1 flex-wrap">
                {DAYS.map((day) => (
                  <button
                    key={day}
                    type="button"
                    onClick={() => toggleDay(idx, day)}
                    className={`h-7 w-9 rounded text-xs font-medium transition-all ${
                      period.days.includes(day)
                        ? "bg-primary text-primary-foreground"
                        : "bg-card text-muted-foreground border border-border hover:border-primary/50"
                    }`}
                  >
                    {DAY_LABELS[day][locale]}
                  </button>
                ))}
                <div className="flex-1" />
                {periods.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removePeriod(idx)}
                    className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                    aria-label={lbl ? "Odebrat" : "Remove"}
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>

              {/* Closed toggle + time range */}
              <div className="flex items-center gap-2 flex-wrap">
                <label className="flex items-center gap-1.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={period.closed}
                    onChange={() => toggleClosed(idx)}
                    className="accent-primary h-3.5 w-3.5"
                  />
                  <span className="text-xs text-muted-foreground">{lbl ? "Zavřeno" : "Closed"}</span>
                </label>

                {!period.closed && (
                  <div className="flex items-center gap-1.5 ml-auto">
                    <Clock size={12} className="text-muted-foreground" />
                    <select
                      value={period.open}
                      onChange={(e) => updatePeriod(idx, "open", e.target.value)}
                      className="h-7 rounded border border-border bg-card px-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    >
                      {HOUR_OPTIONS.filter((h) => h !== "24:00").map((h) => (
                        <option key={h} value={h}>{h}</option>
                      ))}
                    </select>
                    <span className="text-xs text-muted-foreground">–</span>
                    <select
                      value={period.close}
                      onChange={(e) => updatePeriod(idx, "close", e.target.value)}
                      className="h-7 rounded border border-border bg-card px-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    >
                      {HOUR_OPTIONS.map((h) => (
                        <option key={h} value={h}>{h}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            </div>
          ))}

          <Button type="button" variant="outline" size="sm" onClick={addPeriod} className="w-full gap-1.5">
            <Plus size={13} />
            {lbl ? "Přidat období" : "Add period"}
          </Button>
        </>
      )}

      {/* OSM preview */}
      {osmPreview && (
        <div className="flex items-start gap-2 rounded-md bg-muted/50 border border-border px-3 py-2">
          <span className="text-[10px] text-muted-foreground shrink-0 mt-0.5 font-medium uppercase tracking-wide">
            OSM
          </span>
          <code className="text-xs text-foreground font-mono break-all">{osmPreview}</code>
        </div>
      )}
    </div>
  );
}
