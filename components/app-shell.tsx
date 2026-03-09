"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import type { QuestItem, OsmUser, OsmNote, OsmNoteComment, SolvedQuest } from "@/lib/store";
import { getUser, getLocale, setLocale, getSolvedQuests, getEnabledQuestTypes, setEnabledQuestTypes } from "@/lib/store";
import { QUEST_TYPES } from "@/lib/quest-types";
import { fetchQuests, type BBox } from "@/lib/overpass";
import type { Locale } from "@/lib/i18n";
import { t } from "@/lib/i18n";
import QuestPanel from "@/components/quest-panel";
import NotesPanel from "@/components/notes-panel";
import CreateNoteDialog from "@/components/create-note-dialog";
import StatsPanel from "@/components/stats-panel";
import QuestFilter from "@/components/quest-filter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import {
  Map, ListTodo, MessageSquare, BarChart3, Filter,
  LogIn, LogOut, Globe, Sun, Moon,
  Loader2, MapPin, Plus, ChevronLeft, ChevronRight,
  RefreshCw, Crosshair, Menu, X,
} from "lucide-react";
import { toast, Toaster } from "sonner";

const GeoMap = dynamic(() => import("@/components/geo-map"), { ssr: false });

type SidebarTab = "quests" | "notes" | "stats" | "filter" | "settings";

export default function AppShell() {
  // State
  const [locale, setLocaleState] = useState<Locale>("en");
  const [user, setUser] = useState<OsmUser | null>(null);
  const [quests, setQuests] = useState<QuestItem[]>([]);
  const [notes, setNotes] = useState<OsmNote[]>([]);
  const [selectedQuest, setSelectedQuest] = useState<QuestItem | null>(null);
  const [selectedNote, setSelectedNote] = useState<OsmNote | null>(null);
  const [showNotes, setShowNotes] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("quests");
  const [solved, setSolved] = useState<SolvedQuest[]>([]);
  const [enabledTypes, setEnabledTypes] = useState<string[]>(QUEST_TYPES.map((q) => q.id));
  const [creatingNote, setCreatingNote] = useState(false);
  const [noteCreatePos, setNoteCreatePos] = useState<{ lat: number; lon: number } | null>(null);
  const [dark, setDark] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const boundsRef = useRef<BBox | null>(null);
  const fetchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Init
  useEffect(() => {
    setLocaleState(getLocale());
    setUser(getUser());
    setSolved(getSolvedQuests());

    const savedTypes = getEnabledQuestTypes();
    if (savedTypes) setEnabledTypes(savedTypes);

    // Check URL params
    const params = new URLSearchParams(window.location.search);
    if (params.get("login") === "success") {
      toast.success(locale === "cs" ? "Uspesne prihlaseni!" : "Successfully logged in!");
      window.history.replaceState({}, "", "/");
      setUser(getUser());
    }
    if (params.get("error")) {
      toast.error(`Auth error: ${params.get("error")}`);
      window.history.replaceState({}, "", "/");
    }

    // Theme
    const savedTheme = localStorage.getItem("gc_theme");
    if (savedTheme === "dark" || (!savedTheme && window.matchMedia("(prefers-color-scheme: dark)").matches)) {
      setDark(true);
      document.documentElement.classList.add("dark");
    }
  }, []);

  // Fetch quests on bounds change
  const loadQuests = useCallback(async (bounds: BBox) => {
    const activeTypes = QUEST_TYPES.filter((qt) => enabledTypes.includes(qt.id));
    if (activeTypes.length === 0) {
      setQuests([]);
      return;
    }

    setLoading(true);
    try {
      const items = await fetchQuests(bounds, activeTypes, 100);
      // Filter out already solved
      const solvedIds = new Set(solved.map((s) => `${s.questTypeId}-${s.elementId}`));
      const filtered = items.filter((q) => !solvedIds.has(`${q.questTypeId}-${q.id}`));
      setQuests(filtered);
    } catch (err) {
      console.error("Failed to fetch quests:", err);
    } finally {
      setLoading(false);
    }
  }, [enabledTypes, solved]);

  const handleBoundsChange = useCallback((bounds: BBox) => {
    boundsRef.current = bounds;
    if (fetchTimeoutRef.current) clearTimeout(fetchTimeoutRef.current);
    fetchTimeoutRef.current = setTimeout(() => {
      loadQuests(bounds);
    }, 800);
  }, [loadQuests]);

  // Fetch notes
  const loadNotes = useCallback(async () => {
    if (!boundsRef.current || !showNotes) return;
    const b = boundsRef.current;
    try {
      const res = await fetch(
        `/api/osm/notes?bbox=${b.west},${b.south},${b.east},${b.north}&limit=100`
      );
      const data = await res.json();
      if (data.features) {
        const parsed: OsmNote[] = data.features.map((f: {
          properties: {
            id: number;
            status: "open" | "closed";
            date_created: string;
            comments: OsmNoteComment[];
          };
          geometry: { coordinates: [number, number] };
        }) => ({
          id: f.properties.id,
          lat: f.geometry.coordinates[1],
          lon: f.geometry.coordinates[0],
          status: f.properties.status,
          date_created: f.properties.date_created,
          comments: f.properties.comments || [],
        }));
        setNotes(parsed);
      }
    } catch (err) {
      console.error("Failed to fetch notes:", err);
    }
  }, [showNotes]);

  useEffect(() => {
    if (showNotes && boundsRef.current) {
      loadNotes();
    }
  }, [showNotes, loadNotes]);

  // Handlers
  const handleLogin = () => {
    window.location.href = `/api/osm/auth?origin=${window.location.origin}`;
  };

  const handleLogout = async () => {
    await fetch("/api/osm/logout", { method: "POST" });
    setUser(null);
    toast.success(locale === "cs" ? "Odhlaseni uspesne" : "Logged out successfully");
  };

  const handleToggleLocale = () => {
    const newLocale = locale === "en" ? "cs" : "en";
    setLocaleState(newLocale);
    setLocale(newLocale);
  };

  const handleToggleDark = () => {
    const newDark = !dark;
    setDark(newDark);
    document.documentElement.classList.toggle("dark", newDark);
    localStorage.setItem("gc_theme", newDark ? "dark" : "light");
  };

  const handleToggleType = (typeId: string) => {
    setEnabledTypes((prev) => {
      const next = prev.includes(typeId)
        ? prev.filter((id) => id !== typeId)
        : [...prev, typeId];
      setEnabledQuestTypes(next);
      return next;
    });
  };

  const handleRefresh = () => {
    if (boundsRef.current) {
      loadQuests(boundsRef.current);
      if (showNotes) loadNotes();
    }
  };

  const handleQuestSolved = () => {
    setSelectedQuest(null);
    setSolved(getSolvedQuests());
    if (boundsRef.current) loadQuests(boundsRef.current);
  };

  const handleMapClick = (lat: number, lon: number) => {
    if (creatingNote) {
      setNoteCreatePos({ lat, lon });
      setCreatingNote(false);
    }
  };

  const handleSelectNote = (note: OsmNote | null) => {
    setSelectedNote(note);
    setSelectedQuest(null);
    if (note) {
      setSidebarOpen(true);
      setSidebarTab("notes");
    }
  };

  const questCounts: Record<string, number> = {};
  quests.forEach((q) => {
    questCounts[q.questTypeId] = (questCounts[q.questTypeId] || 0) + 1;
  });

  const totalQuests = quests.length;

  return (
    <TooltipProvider>
      <div className="flex h-screen w-full overflow-hidden bg-background">
        {/* Left sidebar nav - icons */}
        <div className="hidden md:flex flex-col items-center py-3 px-1.5 bg-sidebar border-r border-sidebar-border gap-1 w-14 shrink-0">
          {/* Logo */}
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground mb-2 font-bold text-sm">
            GC
          </div>

          <Separator className="bg-sidebar-border my-1 w-8" />

          <NavIcon
            icon={<ListTodo size={20} />}
            label={t(locale, "quests", "title")}
            active={sidebarTab === "quests" && sidebarOpen}
            onClick={() => { setSidebarTab("quests"); setSidebarOpen(true); }}
          />
          <NavIcon
            icon={<Filter size={20} />}
            label={t(locale, "quests", "categories")}
            active={sidebarTab === "filter" && sidebarOpen}
            onClick={() => { setSidebarTab("filter"); setSidebarOpen(true); }}
          />
          <NavIcon
            icon={<MessageSquare size={20} />}
            label={t(locale, "notes", "title")}
            active={sidebarTab === "notes" && sidebarOpen}
            onClick={() => { setSidebarTab("notes"); setSidebarOpen(true); setShowNotes(true); }}
            badge={showNotes ? notes.filter((n) => n.status === "open").length : undefined}
          />
          <NavIcon
            icon={<BarChart3 size={20} />}
            label={t(locale, "stats", "title")}
            active={sidebarTab === "stats" && sidebarOpen}
            onClick={() => { setSidebarTab("stats"); setSidebarOpen(true); }}
          />

          <div className="flex-1" />

          <NavIcon
            icon={<Globe size={18} />}
            label={locale === "en" ? "Cestina" : "English"}
            onClick={handleToggleLocale}
          />
          <NavIcon
            icon={dark ? <Sun size={18} /> : <Moon size={18} />}
            label={dark ? t(locale, "settings", "light") : t(locale, "settings", "dark")}
            onClick={handleToggleDark}
          />

          {user ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={handleLogout}
                  className="flex h-9 w-9 items-center justify-center rounded-lg hover:bg-sidebar-accent transition-colors"
                >
                  <Avatar className="h-7 w-7">
                    {user.img && <AvatarImage src={user.img} alt={user.display_name} />}
                    <AvatarFallback className="text-xs bg-sidebar-primary text-sidebar-primary-foreground">
                      {user.display_name.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">
                {user.display_name} - {t(locale, "auth", "logout")}
              </TooltipContent>
            </Tooltip>
          ) : (
            <NavIcon
              icon={<LogIn size={18} />}
              label={t(locale, "auth", "login")}
              onClick={handleLogin}
            />
          )}
        </div>

        {/* Content sidebar */}
        {sidebarOpen && (
          <div className="hidden md:flex flex-col w-80 bg-card border-r border-border shrink-0">
            {/* Sidebar header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h2 className="font-semibold text-foreground text-sm">
                {sidebarTab === "quests" && t(locale, "quests", "title")}
                {sidebarTab === "filter" && t(locale, "quests", "categories")}
                {sidebarTab === "notes" && t(locale, "notes", "title")}
                {sidebarTab === "stats" && t(locale, "stats", "title")}
              </h2>
              <div className="flex items-center gap-1">
                {sidebarTab === "quests" && (
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleRefresh} disabled={loading}>
                    <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
                  </Button>
                )}
                {sidebarTab === "notes" && (
                  <>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => setCreatingNote(!creatingNote)}
                    >
                      <Plus size={14} />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={loadNotes}>
                      <RefreshCw size={14} />
                    </Button>
                  </>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => setSidebarOpen(false)}
                >
                  <ChevronLeft size={14} />
                </Button>
              </div>
            </div>

            {/* Sidebar content */}
            <div className="flex-1 overflow-hidden">
              {selectedQuest && sidebarTab === "quests" && (
                <QuestPanel
                  quest={selectedQuest}
                  locale={locale}
                  user={user}
                  onClose={() => setSelectedQuest(null)}
                  onSolved={handleQuestSolved}
                />
              )}

              {selectedNote && sidebarTab === "notes" && (
                <NotesPanel
                  note={selectedNote}
                  locale={locale}
                  user={user}
                  onClose={() => setSelectedNote(null)}
                  onUpdated={() => { loadNotes(); setSelectedNote(null); }}
                />
              )}

              {!selectedQuest && sidebarTab === "quests" && (
                <QuestList
                  quests={quests}
                  locale={locale}
                  loading={loading}
                  onSelect={(q) => { setSelectedQuest(q); }}
                />
              )}

              {!selectedNote && sidebarTab === "notes" && (
                <NotesList
                  notes={notes}
                  locale={locale}
                  showNotes={showNotes}
                  onToggleNotes={() => setShowNotes(!showNotes)}
                  onSelect={handleSelectNote}
                  creatingNote={creatingNote}
                />
              )}

              {sidebarTab === "filter" && (
                <QuestFilter
                  enabledTypes={enabledTypes}
                  onToggleType={handleToggleType}
                  questCounts={questCounts}
                  locale={locale}
                />
              )}

              {sidebarTab === "stats" && (
                <StatsPanel solved={solved} locale={locale} />
              )}
            </div>
          </div>
        )}

        {/* Collapsed sidebar toggle */}
        {!sidebarOpen && (
          <button
            onClick={() => setSidebarOpen(true)}
            className="hidden md:flex absolute left-14 top-1/2 -translate-y-1/2 z-[500] h-8 w-5 items-center justify-center rounded-r-md bg-card border border-l-0 border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <ChevronRight size={14} />
          </button>
        )}

        {/* Map area */}
        <div className="flex-1 relative">
          {/* Mobile header */}
          <div className="md:hidden absolute top-0 left-0 right-0 z-[500] flex items-center gap-2 bg-card/95 backdrop-blur border-b border-border px-3 py-2">
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted"
            >
              {mobileMenuOpen ? <X size={18} /> : <Menu size={18} />}
            </button>
            <div className="flex h-7 w-7 items-center justify-center rounded bg-primary text-primary-foreground font-bold text-xs">
              GC
            </div>
            <span className="font-semibold text-foreground text-sm">GeoComplete</span>
            <div className="flex-1" />
            {loading && <Loader2 size={16} className="animate-spin text-primary" />}
            <Badge variant="secondary" className="text-xs">
              {totalQuests}
            </Badge>
            {user ? (
              <Avatar className="h-6 w-6">
                {user.img && <AvatarImage src={user.img} alt={user.display_name} />}
                <AvatarFallback className="text-xs bg-primary text-primary-foreground">
                  {user.display_name.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
            ) : (
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleLogin}>
                <LogIn size={12} className="mr-1" />
                {t(locale, "auth", "loginToContribute")}
              </Button>
            )}
          </div>

          {/* Mobile menu */}
          {mobileMenuOpen && (
            <div className="md:hidden absolute top-12 left-0 right-0 z-[500] bg-card border-b border-border p-3 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant={showNotes ? "default" : "outline"}
                className="text-xs"
                onClick={() => { setShowNotes(!showNotes); if (!showNotes) loadNotes(); }}
              >
                <MessageSquare size={12} className="mr-1" />
                {t(locale, "notes", showNotes ? "hideNotes" : "showNotes")}
              </Button>
              <Button size="sm" variant="outline" className="text-xs" onClick={handleRefresh}>
                <RefreshCw size={12} className="mr-1" />
                {locale === "cs" ? "Obnovit" : "Refresh"}
              </Button>
              <Button size="sm" variant="outline" className="text-xs" onClick={handleToggleLocale}>
                <Globe size={12} className="mr-1" />
                {locale === "en" ? "CZ" : "EN"}
              </Button>
              <Button size="sm" variant="outline" className="text-xs" onClick={handleToggleDark}>
                {dark ? <Sun size={12} /> : <Moon size={12} />}
              </Button>
              {user && (
                <Button size="sm" variant="outline" className="text-xs" onClick={handleLogout}>
                  <LogOut size={12} className="mr-1" />
                  {t(locale, "auth", "logout")}
                </Button>
              )}
            </div>
          )}

          {/* Map status bar */}
          <div className="hidden md:flex absolute top-3 left-3 z-[500] items-center gap-2">
            <div className="flex items-center gap-2 rounded-lg bg-card/95 backdrop-blur border border-border px-3 py-1.5 shadow-sm">
              {loading ? (
                <Loader2 size={14} className="animate-spin text-primary" />
              ) : (
                <MapPin size={14} className="text-primary" />
              )}
              <span className="text-xs text-foreground font-medium">
                {totalQuests} {t(locale, "map", "questsFound")}
              </span>
            </div>

            {creatingNote && (
              <div className="flex items-center gap-2 rounded-lg bg-accent/90 backdrop-blur border border-accent px-3 py-1.5 shadow-sm">
                <Crosshair size={14} className="text-accent-foreground" />
                <span className="text-xs text-accent-foreground font-medium">
                  {locale === "cs" ? "Kliknete na mapu pro vytvoreni poznamky" : "Click on the map to create a note"}
                </span>
                <button
                  onClick={() => setCreatingNote(false)}
                  className="ml-1 text-accent-foreground hover:text-foreground"
                >
                  <X size={12} />
                </button>
              </div>
            )}
          </div>

          {/* Map */}
          <GeoMap
            quests={quests}
            notes={notes}
            showNotes={showNotes}
            selectedQuest={selectedQuest}
            onSelectQuest={(q) => {
              setSelectedQuest(q);
              setSelectedNote(null);
              if (q) {
                setSidebarOpen(true);
                setSidebarTab("quests");
              }
            }}
            onSelectNote={handleSelectNote}
            onBoundsChange={handleBoundsChange}
            onMapClick={handleMapClick}
            creatingNote={creatingNote}
          />
        </div>

        {/* Note creation dialog */}
        {noteCreatePos && (
          <CreateNoteDialog
            open={true}
            lat={noteCreatePos.lat}
            lon={noteCreatePos.lon}
            locale={locale}
            onClose={() => setNoteCreatePos(null)}
            onCreated={() => {
              setNoteCreatePos(null);
              loadNotes();
            }}
          />
        )}

        <Toaster richColors position="bottom-right" />
      </div>
    </TooltipProvider>
  );
}

// Sub-components

function NavIcon({
  icon,
  label,
  active,
  onClick,
  badge,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  onClick?: () => void;
  badge?: number;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          className={`relative flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
            active
              ? "bg-sidebar-primary text-sidebar-primary-foreground"
              : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          }`}
        >
          {icon}
          {badge !== undefined && badge > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-destructive text-[9px] font-medium text-white px-1">
              {badge > 99 ? "99+" : badge}
            </span>
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" className="text-xs">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

function QuestList({
  quests,
  locale,
  loading,
  onSelect,
}: {
  quests: QuestItem[];
  locale: Locale;
  loading: boolean;
  onSelect: (q: QuestItem) => void;
}) {
  if (loading && quests.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 p-6">
        <Loader2 size={32} className="animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">{t(locale, "map", "loading")}</p>
      </div>
    );
  }

  if (quests.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 p-6 text-center">
        <Map size={48} className="text-muted-foreground/30" />
        <p className="text-sm text-muted-foreground leading-relaxed">{t(locale, "map", "noQuests")}</p>
      </div>
    );
  }

  // Group by type
  const grouped: Record<string, QuestItem[]> = {};
  quests.forEach((q) => {
    if (!grouped[q.questTypeId]) grouped[q.questTypeId] = [];
    grouped[q.questTypeId].push(q);
  });

  return (
    <ScrollArea className="h-full">
      <div className="p-2 flex flex-col gap-1">
        <p className="text-xs text-muted-foreground px-2 py-1">
          {t(locale, "map", "clickToSolve")}
        </p>
        {Object.entries(grouped).map(([typeId, items]) => {
          const qt = QUEST_TYPES.find((q) => q.id === typeId);
          if (!qt) return null;
          return (
            <div key={typeId}>
              <div className="flex items-center gap-2 px-2 py-1.5">
                <div
                  className="h-3 w-3 rounded-full"
                  style={{ background: qt.color }}
                />
                <span className="text-xs font-medium text-foreground">
                  {t(locale, "quests", qt.titleKey)}
                </span>
                <Badge variant="secondary" className="text-xs px-1.5 py-0 h-4 ml-auto">
                  {items.length}
                </Badge>
              </div>
              {items.slice(0, 10).map((q) => (
                <button
                  key={`${q.questTypeId}-${q.id}`}
                  onClick={() => onSelect(q)}
                  className="w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-xs text-left hover:bg-muted/50 transition-colors"
                >
                  <MapPin size={12} className="text-muted-foreground shrink-0" />
                  <span className="text-muted-foreground truncate">
                    {q.tags.name || q.tags.ref || `${q.elementType}/${q.id}`}
                  </span>
                </button>
              ))}
              {items.length > 10 && (
                <p className="text-xs text-muted-foreground px-3 py-1">
                  +{items.length - 10} {locale === "cs" ? "dalsich" : "more"}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </ScrollArea>
  );
}

function NotesList({
  notes,
  locale,
  showNotes,
  onToggleNotes,
  onSelect,
  creatingNote,
}: {
  notes: OsmNote[];
  locale: Locale;
  showNotes: boolean;
  onToggleNotes: () => void;
  onSelect: (note: OsmNote) => void;
  creatingNote: boolean;
}) {
  return (
    <ScrollArea className="h-full">
      <div className="p-4 flex flex-col gap-3">
        <Button
          variant={showNotes ? "default" : "outline"}
          size="sm"
          onClick={onToggleNotes}
          className="w-full"
        >
          <MessageSquare size={14} className="mr-1" />
          {t(locale, "notes", showNotes ? "hideNotes" : "showNotes")}
        </Button>

        {showNotes && notes.length === 0 && (
          <div className="text-center py-6">
            <MessageSquare size={32} className="mx-auto text-muted-foreground/30 mb-2" />
            <p className="text-sm text-muted-foreground">{t(locale, "notes", "noNotes")}</p>
          </div>
        )}

        {showNotes && notes.length > 0 && (
          <div className="flex flex-col gap-1">
            {notes.map((note) => (
              <button
                key={note.id}
                onClick={() => onSelect(note)}
                className="w-full flex items-start gap-2 p-2 rounded-lg border border-border hover:bg-muted/50 text-left transition-colors"
              >
                <div
                  className={`mt-0.5 h-2.5 w-2.5 rounded-sm shrink-0 ${
                    note.status === "open" ? "bg-destructive" : "bg-muted-foreground"
                  }`}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-foreground line-clamp-2">
                    {note.comments[0]?.text?.slice(0, 120) || "..."}
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs text-muted-foreground">
                      #{note.id}
                    </span>
                    <Badge
                      variant={note.status === "open" ? "destructive" : "secondary"}
                      className="text-xs px-1 py-0 h-4"
                    >
                      {t(locale, "notes", note.status)}
                    </Badge>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
