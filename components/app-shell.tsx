"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import type { QuestItem, OsmUser, OsmNote, OsmNoteComment, SolvedQuest } from "@/lib/store";
import { getUser, getLocale, setLocale, getSolvedQuests, getEnabledQuestTypes, setEnabledQuestTypes } from "@/lib/store";
import { QUEST_TYPES } from "@/lib/quest-types";
import { fetchQuests, type BBox, isBBoxTooLarge, clearQuestCache, getCacheStats, MIN_ZOOM_FOR_LOAD } from "@/lib/overpass";
import type { Locale } from "@/lib/i18n";
import { t } from "@/lib/i18n";
import type { MapLayer } from "@/components/geo-map";
import QuestPanel from "@/components/quest-panel";
import CustomTagPanel from "@/components/custom-tag-panel";
import NotesPanel from "@/components/notes-panel";
import CreateNoteDialog from "@/components/create-note-dialog";
import AddPoiDialog from "@/components/add-poi-dialog";
import StatsPanel from "@/components/stats-panel";
import LeaderboardPanel from "@/components/leaderboard-panel";
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
  RefreshCw, Crosshair, Menu, X, Trophy, Settings2,
  ChevronDown, ChevronUp, Trash2, Tag,
} from "lucide-react";
import { toast, Toaster } from "sonner";

const GeoMap = dynamic(() => import("@/components/geo-map"), { ssr: false });

type SidebarTab = "quests" | "notes" | "stats" | "filter" | "leaderboard" | "settings";

export default function AppShell() {
  const [locale, setLocaleState] = useState<Locale>("en");
  const [user, setUser] = useState<OsmUser | null>(null);
  const [quests, setQuests] = useState<QuestItem[]>([]);
  // `allFetchedQuests` holds the raw Overpass results; `quests` is the filtered view
  const allFetchedQuestsRef = useRef<QuestItem[]>([]);
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
  const [poiDialogOpen, setPoiDialogOpen] = useState(false);
  const [poiCreatePos, setPoiCreatePos] = useState<{ lat: number; lon: number } | null>(null);
  const [creatingPoi, setCreatingPoi] = useState(false);
  const [dark, setDark] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mapLayer, setMapLayer] = useState<MapLayer>("standard");
  const [autoLoad, setAutoLoad] = useState(true);
  const [currentZoom, setCurrentZoom] = useState(15);
  const [cacheStats, setCacheStats] = useState({ tiles: 0, items: 0 });
  // Custom tag mode: instead of quest panel show custom tag panel
  const [customTagMode, setCustomTagMode] = useState(false);
  // Mobile bottom sheet state
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);
  const [mobileSheetTab, setMobileSheetTab] = useState<"quest" | "note" | "list">("list");

  const boundsRef = useRef<BBox | null>(null);
  const fetchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  // GPS readiness: don't load quests until GPS resolves or times out
  const [gpsReady, setGpsReady] = useState(false);
  const gpsReadyRef = useRef(false);

  // Skip storage key (localStorage, works for both authed and anonymous users)
  const SKIP_KEY = "gc_skipped_quests_v1";

  // Init
  useEffect(() => {
    setLocaleState(getLocale());
    setUser(getUser());
    setSolved(getSolvedQuests());

    const savedTypes = getEnabledQuestTypes();
    if (savedTypes) setEnabledTypes(savedTypes);

    const params = new URLSearchParams(window.location.search);
    if (params.get("login") === "success") {
      toast.success(getLocale() === "cs" ? "Uspesne prihlaseni!" : "Successfully logged in!");
      window.history.replaceState({}, "", "/");
      setUser(getUser());
    }
    if (params.get("error")) {
      toast.error(`Auth error: ${params.get("error")}`);
      window.history.replaceState({}, "", "/");
    }

    const savedTheme = localStorage.getItem("gc_theme");
    if (savedTheme === "dark" || (!savedTheme && window.matchMedia("(prefers-color-scheme: dark)").matches)) {
      setDark(true);
      document.documentElement.classList.add("dark");
    }

    const savedAutoLoad = localStorage.getItem("gc_autoload");
    if (savedAutoLoad !== null) setAutoLoad(savedAutoLoad !== "false");

    const savedLayer = localStorage.getItem("gc_layer") as MapLayer | null;
    if (savedLayer) setMapLayer(savedLayer);

    setCacheStats(getCacheStats());

    // GPS: try to get user location; load quests only after GPS resolves or times out
    const gpsTimeout = setTimeout(() => {
      if (!gpsReadyRef.current) {
        gpsReadyRef.current = true;
        setGpsReady(true);
      }
    }, 3000);

    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        () => {
          clearTimeout(gpsTimeout);
          gpsReadyRef.current = true;
          setGpsReady(true);
        },
        () => {
          clearTimeout(gpsTimeout);
          gpsReadyRef.current = true;
          setGpsReady(true);
        },
        { timeout: 4000, maximumAge: 30000 }
      );
    } else {
      clearTimeout(gpsTimeout);
      gpsReadyRef.current = true;
      setGpsReady(true);
    }

    return () => clearTimeout(gpsTimeout);
  }, []);

  // --- Local skip helpers (localStorage, no login required) ---
  const getSkippedSet = useCallback((): Set<string> => {
    try {
      const raw = localStorage.getItem(SKIP_KEY);
      return new Set(raw ? JSON.parse(raw) : []);
    } catch { return new Set(); }
  }, [SKIP_KEY]);

  const addSkipped = useCallback((questTypeId: string, elementId: string) => {
    try {
      const set = getSkippedSet();
      set.add(`${questTypeId}|${elementId}`);
      localStorage.setItem(SKIP_KEY, JSON.stringify([...set]));
    } catch { /* ignore */ }
  }, [getSkippedSet, SKIP_KEY]);

  const loadQuests = useCallback(async (bounds: BBox) => {
    if (isBBoxTooLarge(bounds)) {
      allFetchedQuestsRef.current = [];
      setQuests([]);
      return;
    }
    const activeTypes = QUEST_TYPES.filter((qt) => enabledTypes.includes(qt.id));
    if (activeTypes.length === 0) { allFetchedQuestsRef.current = []; setQuests([]); return; }

    setLoading(true);
    try {
      // Fetch from new cached API instead of Overpass directly
      const res = await fetch("/api/quests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bounds,
          questTypes: activeTypes.map((qt) => qt.id),
        }),
      });
      
      const data = await res.json();
      if (!data.quests) throw new Error(data.error || "Failed to fetch quests");

      const skipped = getSkippedSet();
      const solvedIds = new Set(getSolvedQuests().map((s) => `${s.questTypeId}-${s.elementId}`));
      const items = (data.quests as typeof quests).filter(
        (q) => !skipped.has(`${q.questTypeId}|${q.id}`) && !solvedIds.has(`${q.questTypeId}-${q.id}`)
      );
      allFetchedQuestsRef.current = items;
      // Apply enabled filter immediately
      const visible = items.filter((q) => enabledTypes.includes(q.questTypeId));
      setQuests(visible);
      setCacheStats(getCacheStats());
    } catch (err) {
      console.error("Failed to fetch quests:", err);
      toast.error(locale === "cs" ? "Chyba pri nacitani questu" : "Failed to load quests");
    } finally {
      setLoading(false);
    }
  }, [enabledTypes, locale]);

  const handleBoundsChange = useCallback((bounds: BBox, zoom: number) => {
    boundsRef.current = bounds;
    setCurrentZoom(zoom);
    if (!autoLoad) return;
    if (zoom < MIN_ZOOM_FOR_LOAD) return;
    if (!gpsReadyRef.current) return; // Wait for GPS to resolve first
    if (fetchTimeoutRef.current) clearTimeout(fetchTimeoutRef.current);
    fetchTimeoutRef.current = setTimeout(() => {
      loadQuests(bounds);
    }, 900);
  }, [loadQuests, autoLoad]);

  const loadNotes = useCallback(async () => {
    if (!boundsRef.current || !showNotes) return;
    const b = boundsRef.current;
    try {
      const res = await fetch(`/api/osm/notes?bbox=${b.west},${b.south},${b.east},${b.north}&limit=100`);
      const data = await res.json();
      if (data.features) {
        const parsed: OsmNote[] = data.features.map((f: {
          properties: { id: number; status: "open" | "closed"; date_created: string; comments: OsmNoteComment[] };
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
    if (showNotes && boundsRef.current) loadNotes();
  }, [showNotes, loadNotes]);

  // Once GPS resolves, trigger the first quest load for current bounds
  useEffect(() => {
    if (!gpsReady) return;
    if (!autoLoad) return;
    if (!boundsRef.current) return;
    const bounds = boundsRef.current;
    if (currentZoom >= MIN_ZOOM_FOR_LOAD && !isBBoxTooLarge(bounds)) {
      loadQuests(bounds);
    }
  }, [gpsReady]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleLogin = () => { window.location.href = `/api/osm/auth?origin=${window.location.origin}`; };
  const handleLogout = async () => {
    await fetch("/api/osm/logout", { method: "POST" });
    setUser(null);
    toast.success(locale === "cs" ? "Odhlaseni uspesne" : "Logged out successfully");
  };
  const handleToggleLocale = () => {
    const next = locale === "en" ? "cs" : "en";
    setLocaleState(next);
    setLocale(next);
  };
  const handleToggleDark = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("gc_theme", next ? "dark" : "light");
  };
  const handleToggleType = (typeId: string) => {
    setEnabledTypes((prev) => {
      const next = prev.includes(typeId) ? prev.filter((id) => id !== typeId) : [...prev, typeId];
      setEnabledQuestTypes(next);
      // Immediately re-filter the map without a new API call
      const visible = allFetchedQuestsRef.current.filter((q) => next.includes(q.questTypeId));
      setQuests(visible);
      return next;
    });
  };
  const handleRefresh = () => {
    if (boundsRef.current) {
      loadQuests(boundsRef.current);
      if (showNotes) loadNotes();
    }
  };
  const handleQuestSkipped = useCallback((questTypeId: string, elementId: string) => {
    addSkipped(questTypeId, elementId);
    setSelectedQuest(null);
    setMobileSheetOpen(false);
    // Remove from map immediately
    allFetchedQuestsRef.current = allFetchedQuestsRef.current.filter(
      (q) => !(q.questTypeId === questTypeId && q.id === elementId)
    );
    setQuests((prev) => prev.filter((q) => !(q.questTypeId === questTypeId && q.id === elementId)));
  }, [addSkipped]);
    setSelectedQuest(null);
    setCustomTagMode(false);
    setSolved(getSolvedQuests());
    setMobileSheetOpen(false);
    // Re-apply filter after solving so the solved quest disappears immediately
    const solvedIds = new Set(getSolvedQuests().map((s) => `${s.questTypeId}-${s.elementId}`));
    const visible = allFetchedQuestsRef.current.filter(
      (q) => !solvedIds.has(`${q.questTypeId}-${q.id}`) && enabledTypes.includes(q.questTypeId)
    );
    allFetchedQuestsRef.current = visible;
    setQuests(visible);
  };
  const handleSelectQuest = (q: QuestItem | null) => {
    setSelectedQuest(q);
    setSelectedNote(null);
    setCustomTagMode(false);
    if (q) {
      setSidebarOpen(true);
      setSidebarTab("quests");
      // Mobile: open bottom sheet
      setMobileSheetOpen(true);
      setMobileSheetTab("quest");
    } else {
      setMobileSheetOpen(false);
    }
  };
  const handleSelectNote = (note: OsmNote | null) => {
    setSelectedNote(note);
    setSelectedQuest(null);
    setCustomTagMode(false);
    if (note) {
      setSidebarOpen(true);
      setSidebarTab("notes");
      setMobileSheetOpen(true);
      setMobileSheetTab("note");
    } else {
      setMobileSheetOpen(false);
    }
  };
  const handleMapLayerChange = (layer: MapLayer) => {
    setMapLayer(layer);
    localStorage.setItem("gc_layer", layer);
  };
  const handleToggleAutoLoad = (val: boolean) => {
    setAutoLoad(val);
    localStorage.setItem("gc_autoload", String(val));
  };
  const handleClearCache = () => {
    clearQuestCache();
    setQuests([]);
    setCacheStats({ tiles: 0, items: 0 });
    toast.success(t(locale, "settings", "cacheCleaned"));
  };

  const questCounts: Record<string, number> = {};
  quests.forEach((q) => { questCounts[q.questTypeId] = (questCounts[q.questTypeId] || 0) + 1; });
  const totalQuests = quests.length;
  const zoomTooLow = currentZoom < MIN_ZOOM_FOR_LOAD;

  // --- Desktop quest content renderer ---
  const renderSidebarContent = () => {
    if (sidebarTab === "quests") {
      if (customTagMode && selectedQuest) {
        return (
          <CustomTagPanel
            quest={selectedQuest}
            locale={locale}
            user={user}
            onClose={() => setCustomTagMode(false)}
            onSolved={handleQuestSolved}
          />
        );
      }
      if (selectedQuest) {
        return (
          <QuestPanel
            quest={selectedQuest}
            locale={locale}
            user={user}
            onClose={() => setSelectedQuest(null)}
            onSolved={handleQuestSolved}
            onSkipped={handleQuestSkipped}
            onCustomTag={() => setCustomTagMode(true)}
          />
        );
      }
      return <QuestList quests={quests} locale={locale} loading={loading} zoomTooLow={zoomTooLow} onSelect={handleSelectQuest} />;
    }
    if (sidebarTab === "notes") {
      if (selectedNote) {
        return (
          <NotesPanel
            note={selectedNote}
            locale={locale}
            user={user}
            onClose={() => setSelectedNote(null)}
            onUpdated={() => { loadNotes(); setSelectedNote(null); }}
          />
        );
      }
      return (
        <NotesList
          notes={notes}
          locale={locale}
          showNotes={showNotes}
          onToggleNotes={() => { setShowNotes(!showNotes); if (!showNotes) loadNotes(); }}
          onSelect={handleSelectNote}
          creatingNote={creatingNote}
        />
      );
    }
    if (sidebarTab === "filter") return <QuestFilter enabledTypes={enabledTypes} onToggleType={handleToggleType} questCounts={questCounts} locale={locale} />;
    if (sidebarTab === "stats") return <StatsPanel solved={solved} locale={locale} />;
    if (sidebarTab === "leaderboard") return <LeaderboardPanel solved={solved} locale={locale} username={user?.display_name} />;
    if (sidebarTab === "settings") return (
      <SettingsPanel
        locale={locale}
        dark={dark}
        autoLoad={autoLoad}
        mapLayer={mapLayer}
        cacheStats={cacheStats}
        onToggleDark={handleToggleDark}
        onToggleLocale={handleToggleLocale}
        onToggleAutoLoad={handleToggleAutoLoad}
        onClearCache={handleClearCache}
      />
    );
    return null;
  };

  return (
    <TooltipProvider>
      <div className="flex h-screen w-full overflow-hidden bg-background">

        {/* ===== DESKTOP: Left icon rail ===== */}
        <div className="hidden md:flex flex-col items-center py-3 px-1.5 bg-sidebar border-r border-sidebar-border gap-1 w-14 shrink-0">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground mb-2 font-bold text-xs select-none">
            GC
          </div>
          <Separator className="bg-sidebar-border my-1 w-8" />

          <NavIcon icon={<ListTodo size={20} />} label={t(locale, "quests", "title")}
            active={sidebarTab === "quests" && sidebarOpen}
            onClick={() => { setSidebarTab("quests"); setSidebarOpen(true); }} />
          <NavIcon icon={<Filter size={20} />} label={t(locale, "quests", "categories")}
            active={sidebarTab === "filter" && sidebarOpen}
            onClick={() => { setSidebarTab("filter"); setSidebarOpen(true); }} />
          <NavIcon icon={<MessageSquare size={20} />} label={t(locale, "notes", "title")}
            active={sidebarTab === "notes" && sidebarOpen}
            badge={showNotes ? notes.filter((n) => n.status === "open").length : undefined}
            onClick={() => { setSidebarTab("notes"); setSidebarOpen(true); setShowNotes(true); }} />
          <NavIcon icon={<BarChart3 size={20} />} label={t(locale, "stats", "title")}
            active={sidebarTab === "stats" && sidebarOpen}
            onClick={() => { setSidebarTab("stats"); setSidebarOpen(true); }} />
          <NavIcon icon={<Trophy size={20} />} label={t(locale, "leaderboard", "title")}
            active={sidebarTab === "leaderboard" && sidebarOpen}
            onClick={() => { setSidebarTab("leaderboard"); setSidebarOpen(true); }} />

          <div className="flex-1" />

          <NavIcon icon={<Settings2 size={18} />} label={t(locale, "settings", "title")}
            active={sidebarTab === "settings" && sidebarOpen}
            onClick={() => { setSidebarTab("settings"); setSidebarOpen(true); }} />
          <NavIcon icon={<Globe size={18} />} label={locale === "en" ? "Cestina" : "English"}
            onClick={handleToggleLocale} />
          <NavIcon icon={dark ? <Sun size={18} /> : <Moon size={18} />}
            label={dark ? t(locale, "settings", "light") : t(locale, "settings", "dark")}
            onClick={handleToggleDark} />

          {user ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button onClick={handleLogout} className="flex h-9 w-9 items-center justify-center rounded-lg hover:bg-sidebar-accent transition-colors">
                  <Avatar className="h-7 w-7">
                    {user.img && <AvatarImage src={user.img} alt={user.display_name} />}
                    <AvatarFallback className="text-xs bg-sidebar-primary text-sidebar-primary-foreground">
                      {user.display_name.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">{user.display_name} – {t(locale, "auth", "logout")}</TooltipContent>
            </Tooltip>
          ) : (
            <NavIcon icon={<LogIn size={18} />} label={t(locale, "auth", "login")} onClick={handleLogin} />
          )}
        </div>

        {/* ===== DESKTOP: Content sidebar ===== */}
        {sidebarOpen && (
          <div className="hidden md:flex flex-col w-80 bg-card border-r border-border shrink-0">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h2 className="font-semibold text-foreground text-sm">
                {sidebarTab === "quests" && t(locale, "quests", "title")}
                {sidebarTab === "filter" && t(locale, "quests", "categories")}
                {sidebarTab === "notes" && t(locale, "notes", "title")}
                {sidebarTab === "stats" && t(locale, "stats", "title")}
                {sidebarTab === "leaderboard" && t(locale, "leaderboard", "title")}
                {sidebarTab === "settings" && t(locale, "settings", "title")}
              </h2>
              <div className="flex items-center gap-1">
                {sidebarTab === "quests" && !selectedQuest && (
                  <>
                    {!autoLoad && (
                      <Button variant="ghost" size="sm" className="h-7 text-xs px-2" onClick={handleRefresh} disabled={loading || zoomTooLow}>
                        {loading ? <Loader2 size={12} className="animate-spin" /> : t(locale, "map", "loadNow")}
                      </Button>
                    )}
                    <Button
                      variant={creatingPoi ? "default" : "ghost"}
                      size="icon"
                      className="h-7 w-7"
                      title={locale === "cs" ? "Přidat místo (POI)" : "Add POI"}
                      onClick={() => setCreatingPoi((v) => !v)}
                    >
                      <Plus size={14} />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleRefresh} disabled={loading}>
                      <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
                    </Button>
                  </>
                )}
                {sidebarTab === "notes" && (
                  <>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setCreatingNote(!creatingNote)}>
                      <Plus size={14} />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={loadNotes}>
                      <RefreshCw size={14} />
                    </Button>
                  </>
                )}
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setSidebarOpen(false)}>
                  <ChevronLeft size={14} />
                </Button>
              </div>
            </div>
            <div className="flex-1 overflow-hidden">{renderSidebarContent()}</div>
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

        {/* ===== MAP AREA ===== */}
        <div className="flex-1 relative">

          {/* Mobile header */}
          <div className="md:hidden absolute top-0 left-0 right-0 z-[500] flex items-center gap-2 bg-card/95 backdrop-blur border-b border-border px-3 py-2">
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted shrink-0"
            >
              {mobileMenuOpen ? <X size={18} /> : <Menu size={18} />}
            </button>
            <div className="flex h-7 w-7 items-center justify-center rounded bg-primary text-primary-foreground font-bold text-xs shrink-0">
              GC
            </div>
            <span className="font-semibold text-foreground text-sm flex-1 min-w-0 truncate">GeoComplete</span>
            {loading && <Loader2 size={15} className="animate-spin text-primary shrink-0" />}
            <Badge variant="secondary" className="text-xs shrink-0">{totalQuests}</Badge>
            {user ? (
              <Avatar className="h-6 w-6 shrink-0">
                {user.img && <AvatarImage src={user.img} alt={user.display_name} />}
                <AvatarFallback className="text-xs bg-primary text-primary-foreground">
                  {user.display_name.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
            ) : (
              <Button size="sm" variant="outline" className="h-7 text-xs shrink-0" onClick={handleLogin}>
                <LogIn size={12} className="mr-1" />
                {t(locale, "auth", "loginToContribute")}
              </Button>
            )}
          </div>

          {/* Mobile dropdown menu */}
          {mobileMenuOpen && (
            <div className="md:hidden absolute top-[52px] left-0 right-0 z-[500] bg-card border-b border-border p-3 flex flex-wrap gap-2">
              <Button size="sm" variant="outline" className="text-xs" onClick={() => { setMobileSheetOpen(true); setMobileSheetTab("list"); setMobileMenuOpen(false); }}>
                <ListTodo size={12} className="mr-1" />
                {t(locale, "quests", "title")} ({totalQuests})
              </Button>
              <Button size="sm" variant={showNotes ? "default" : "outline"} className="text-xs"
                onClick={() => { setShowNotes(!showNotes); if (!showNotes) loadNotes(); setMobileMenuOpen(false); }}>
                <MessageSquare size={12} className="mr-1" />
                {t(locale, "notes", showNotes ? "hideNotes" : "showNotes")}
              </Button>
              <Button size="sm" variant={mapLayer === "aerial" ? "default" : "outline"} className="text-xs"
                onClick={() => { handleMapLayerChange(mapLayer === "standard" ? "aerial" : "standard"); setMobileMenuOpen(false); }}>
                {mapLayer === "standard" ? t(locale, "map", "aerial") : t(locale, "map", "standard")}
              </Button>
              {!autoLoad && (
                <Button size="sm" variant="outline" className="text-xs" onClick={() => { handleRefresh(); setMobileMenuOpen(false); }} disabled={zoomTooLow}>
                  <RefreshCw size={12} className="mr-1" />
                  {t(locale, "map", "loadNow")}
                </Button>
              )}
              <Button size="sm" variant="outline" className="text-xs" onClick={() => { handleToggleLocale(); setMobileMenuOpen(false); }}>
                <Globe size={12} className="mr-1" />{locale === "en" ? "CZ" : "EN"}
              </Button>
              <Button size="sm" variant="outline" className="text-xs" onClick={() => { handleToggleDark(); setMobileMenuOpen(false); }}>
                {dark ? <Sun size={12} /> : <Moon size={12} />}
              </Button>
              <Button size="sm" variant={autoLoad ? "default" : "outline"} className="text-xs"
                onClick={() => { handleToggleAutoLoad(!autoLoad); setMobileMenuOpen(false); }}>
                {autoLoad ? (locale === "cs" ? "Auto ON" : "Auto ON") : (locale === "cs" ? "Auto OFF" : "Auto OFF")}
              </Button>
              {user && (
                <Button size="sm" variant="outline" className="text-xs" onClick={() => { handleLogout(); setMobileMenuOpen(false); }}>
                  <LogOut size={12} className="mr-1" />{t(locale, "auth", "logout")}
                </Button>
              )}
            </div>
          )}

          {/* Desktop status bar */}
          <div className="hidden md:flex absolute top-3 left-3 z-[500] items-center gap-2 flex-wrap">
            <div className="flex items-center gap-2 rounded-lg bg-card/95 backdrop-blur border border-border px-3 py-1.5 shadow-sm">
              {loading ? <Loader2 size={14} className="animate-spin text-primary" /> : <MapPin size={14} className="text-primary" />}
              <span className="text-xs text-foreground font-medium">
                {totalQuests} {t(locale, "map", "questsFound")}
              </span>
              {zoomTooLow && (
                <span className="text-xs text-amber-500 font-medium ml-1">
                  · zoom {currentZoom}
                </span>
              )}
            </div>
            {!autoLoad && (
              <button
                onClick={handleRefresh}
                disabled={loading || zoomTooLow}
                className="flex items-center gap-1.5 rounded-lg bg-card/95 backdrop-blur border border-primary/40 text-primary px-3 py-1.5 shadow-sm text-xs font-medium hover:bg-primary/10 transition-colors disabled:opacity-50"
              >
                <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
                {t(locale, "map", "loadNow")}
              </button>
            )}
            {creatingNote && (
              <div className="flex items-center gap-2 rounded-lg bg-accent/90 backdrop-blur border border-accent px-3 py-1.5 shadow-sm">
                <Crosshair size={14} className="text-accent-foreground" />
                <span className="text-xs text-accent-foreground font-medium">
                  {locale === "cs" ? "Klikněte na mapu pro poznámku" : "Click on the map to place note"}
                </span>
                <button onClick={() => setCreatingNote(false)} className="text-accent-foreground hover:text-foreground ml-1">
                  <X size={12} />
                </button>
              </div>
            )}
            {creatingPoi && (
              <div className="flex items-center gap-2 rounded-lg bg-primary/90 backdrop-blur border border-primary px-3 py-1.5 shadow-sm">
                <MapPin size={14} className="text-primary-foreground animate-bounce" />
                <span className="text-xs text-primary-foreground font-medium">
                  {locale === "cs" ? "Klikněte na mapu pro umístění" : "Click on the map to place POI"}
                </span>
                <button onClick={() => setCreatingPoi(false)} className="text-primary-foreground hover:text-primary-foreground/70 ml-1">
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
            selectedNote={selectedNote}
            onSelectQuest={handleSelectQuest}
            onSelectNote={handleSelectNote}
            onBoundsChange={handleBoundsChange}
            onMapClick={(lat, lon) => {
              if (creatingNote) {
                setNoteCreatePos({ lat, lon });
                setCreatingNote(false);
              } else if (creatingPoi) {
                setPoiCreatePos({ lat, lon });
                setCreatingPoi(false);
                setPoiDialogOpen(true);
              }
            }}
            creatingNote={creatingNote}
            creatingPoi={creatingPoi}
            mapLayer={mapLayer}
            onMapLayerChange={handleMapLayerChange}
            locale={locale}
          />

          {/* ===== MOBILE BOTTOM SHEET ===== */}
          {/* Quest/Note detail sheet */}
          {mobileSheetOpen && (mobileSheetTab === "quest" || mobileSheetTab === "note") && (
            <div
              className="md:hidden absolute bottom-0 left-0 right-0 z-[600] bg-card border-t border-border rounded-t-2xl shadow-2xl flex flex-col"
              style={{ maxHeight: "78vh" }}
            >
              {/* Drag handle + close */}
              <div className="flex items-center justify-between px-4 pt-2 pb-1 shrink-0">
                <div className="h-1 w-10 rounded-full bg-muted-foreground/30 mx-auto" />
              </div>
              <div className="flex-1 overflow-y-auto overscroll-contain">
                {mobileSheetTab === "quest" && selectedQuest && !customTagMode && (
                  <QuestPanel
                    quest={selectedQuest}
                    locale={locale}
                    user={user}
                    onClose={() => { setSelectedQuest(null); setMobileSheetOpen(false); }}
                    onSolved={handleQuestSolved}
                    onSkipped={handleQuestSkipped}
                    onCustomTag={() => setCustomTagMode(true)}
                  />
                )}
                {mobileSheetTab === "quest" && selectedQuest && customTagMode && (
                  <CustomTagPanel
                    quest={selectedQuest}
                    locale={locale}
                    user={user}
                    onClose={() => setCustomTagMode(false)}
                    onSolved={handleQuestSolved}
                  />
                )}
                {mobileSheetTab === "note" && selectedNote && (
                  <NotesPanel
                    note={selectedNote}
                    locale={locale}
                    user={user}
                    onClose={() => { setSelectedNote(null); setMobileSheetOpen(false); }}
                    onUpdated={() => { loadNotes(); setSelectedNote(null); setMobileSheetOpen(false); }}
                  />
                )}
              </div>
            </div>
          )}

          {/* Quest list bottom sheet */}
          {mobileSheetOpen && mobileSheetTab === "list" && (
            <div
              className="md:hidden absolute bottom-0 left-0 right-0 z-[600] bg-card border-t border-border rounded-t-2xl shadow-2xl flex flex-col"
              style={{ maxHeight: "65vh" }}
            >
              <div className="shrink-0">
                <div className="flex justify-center pt-2">
                  <div className="h-1 w-10 rounded-full bg-muted-foreground/30" />
                </div>
                <div className="flex items-center justify-between px-4 py-2 border-b border-border">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-foreground">{t(locale, "quests", "title")}</span>
                    <Badge variant="secondary" className="text-xs">{totalQuests}</Badge>
                  </div>
                  <div className="flex items-center gap-1">
                    {!autoLoad && (
                      <Button size="sm" variant="ghost" className="h-7 text-xs px-2" onClick={() => { handleRefresh(); }} disabled={loading || zoomTooLow}>
                        <RefreshCw size={11} className={`mr-1 ${loading ? "animate-spin" : ""}`} />
                        {t(locale, "map", "loadNow")}
                      </Button>
                    )}
                    <button onClick={() => setMobileSheetOpen(false)} className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                      <ChevronDown size={16} />
                    </button>
                  </div>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto overscroll-contain">
                <QuestList quests={quests} locale={locale} loading={loading} zoomTooLow={zoomTooLow} onSelect={handleSelectQuest} />
              </div>
            </div>
          )}

          {/* Mobile floating quest count button (when no sheet) */}
          {!mobileSheetOpen && totalQuests > 0 && (
            <button
              className="md:hidden absolute bottom-6 left-1/2 -translate-x-1/2 z-[500] flex items-center gap-2 rounded-full bg-primary text-primary-foreground px-4 py-2.5 shadow-lg text-sm font-medium"
              onClick={() => { setMobileSheetOpen(true); setMobileSheetTab("list"); }}
            >
              <ListTodo size={15} />
              {totalQuests} {t(locale, "map", "questsFound")}
              <ChevronUp size={15} />
            </button>
          )}
        </div>

        {/* Note creation dialog - OUTSIDE map container for proper z-index */}
        {noteCreatePos && (
          <CreateNoteDialog
            open={true}
            lat={noteCreatePos.lat}
            lon={noteCreatePos.lon}
            locale={locale}
            onClose={() => setNoteCreatePos(null)}
            onCreated={() => { setNoteCreatePos(null); loadNotes(); }}
          />
        )}

        {/* Add POI dialog - OUTSIDE map container for proper z-index */}
        {poiCreatePos && (
          <AddPoiDialog
            open={true}
            lat={poiCreatePos.lat}
            lon={poiCreatePos.lon}
            locale={locale}
            user={user}
            onClose={() => { setPoiDialogOpen(false); setPoiCreatePos(null); }}
            onAdded={() => { setPoiDialogOpen(false); setPoiCreatePos(null); }}
          />
        )}

        <Toaster richColors position="bottom-right" />
      </div>
    </TooltipProvider>
  );
}

// ---- Sub-components ----

function NavIcon({ icon, label, active, onClick, badge }: {
  icon: React.ReactNode; label: string; active?: boolean;
  onClick?: () => void; badge?: number;
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
      <TooltipContent side="right" className="text-xs">{label}</TooltipContent>
    </Tooltip>
  );
}

function QuestList({ quests, locale, loading, zoomTooLow, onSelect }: {
  quests: QuestItem[]; locale: Locale; loading: boolean; zoomTooLow: boolean;
  onSelect: (q: QuestItem) => void;
}) {
  if (zoomTooLow) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 p-6 text-center">
        <Map size={40} className="text-muted-foreground/30" />
        <p className="text-sm text-muted-foreground leading-relaxed">{t(locale, "map", "zoomTooLow")}</p>
      </div>
    );
  }
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

  const grouped: Record<string, QuestItem[]> = {};
  quests.forEach((q) => { if (!grouped[q.questTypeId]) grouped[q.questTypeId] = []; grouped[q.questTypeId].push(q); });

  return (
    <ScrollArea className="h-full">
      <div className="p-2 flex flex-col gap-1">
        <p className="text-xs text-muted-foreground px-2 py-1">{t(locale, "map", "clickToSolve")}</p>
        {Object.entries(grouped).map(([typeId, items]) => {
          const qt = QUEST_TYPES.find((q) => q.id === typeId);
          if (!qt) return null;
          return (
            <div key={typeId}>
              <div className="flex items-center gap-2 px-2 py-1.5">
                <div className="h-3 w-3 rounded-full shrink-0" style={{ background: qt.color }} />
                <span className="text-xs font-medium text-foreground">{t(locale, "quests", qt.titleKey)}</span>
                <Badge variant="secondary" className="text-xs px-1.5 py-0 h-4 ml-auto">{items.length}</Badge>
              </div>
              {items.slice(0, 8).map((q) => (
                <button
                  key={`${q.questTypeId}-${q.id}`}
                  onClick={() => onSelect(q)}
                  className="w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-xs text-left hover:bg-muted/50 active:bg-muted transition-colors"
                >
                  <MapPin size={12} className="text-muted-foreground shrink-0" />
                  <span className="text-muted-foreground truncate">
                    {q.tags.name || q.tags.ref || `${q.elementType}/${q.id}`}
                  </span>
                </button>
              ))}
              {items.length > 8 && (
                <p className="text-xs text-muted-foreground px-3 py-1">+{items.length - 8} {locale === "cs" ? "dalsich" : "more"}</p>
              )}
            </div>
          );
        })}
      </div>
    </ScrollArea>
  );
}

function NotesList({ notes, locale, showNotes, onToggleNotes, onSelect, creatingNote }: {
  notes: OsmNote[]; locale: Locale; showNotes: boolean;
  onToggleNotes: () => void; onSelect: (note: OsmNote) => void; creatingNote: boolean;
}) {
  return (
    <ScrollArea className="h-full">
      <div className="p-3 flex flex-col gap-2">
        <Button variant={showNotes ? "default" : "outline"} size="sm" onClick={onToggleNotes} className="w-full">
          <MessageSquare size={14} className="mr-1.5" />
          {t(locale, "notes", showNotes ? "hideNotes" : "showNotes")}
        </Button>
        {showNotes && notes.length === 0 && (
          <div className="text-center py-8">
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
                className="w-full flex items-start gap-2.5 p-2.5 rounded-lg border border-border hover:bg-muted/50 active:bg-muted text-left transition-colors"
              >
                <div className={`mt-1 h-2 w-2 rounded-sm shrink-0 ${note.status === "open" ? "bg-destructive" : "bg-muted-foreground"}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-foreground line-clamp-2 leading-relaxed">
                    {note.comments[0]?.text?.slice(0, 100) || "..."}
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[10px] text-muted-foreground">#{note.id}</span>
                    <Badge
                      variant={note.status === "open" ? "destructive" : "secondary"}
                      className="text-[9px] px-1 py-0 h-3.5"
                    >
                      {t(locale, "notes", note.status)}
                    </Badge>
                  </div>
                </div>
                <MapPin size={12} className="text-muted-foreground/50 shrink-0 mt-1" />
              </button>
            ))}
          </div>
        )}
      </div>
    </ScrollArea>
  );
}

function SettingsPanel({ locale, dark, autoLoad, mapLayer, cacheStats, onToggleDark, onToggleLocale, onToggleAutoLoad, onClearCache }: {
  locale: Locale; dark: boolean; autoLoad: boolean; mapLayer: MapLayer;
  cacheStats: { tiles: number; items: number };
  onToggleDark: () => void; onToggleLocale: () => void;
  onToggleAutoLoad: (v: boolean) => void; onClearCache: () => void;
}) {
  return (
    <ScrollArea className="h-full">
      <div className="p-4 flex flex-col gap-5">

        <section className="flex flex-col gap-3">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t(locale, "settings", "title")}</h3>

          <div className="flex items-center justify-between">
            <span className="text-sm text-foreground">{t(locale, "settings", "language")}</span>
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={onToggleLocale}>
              {locale === "en" ? "English" : "Cestina"}
            </Button>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm text-foreground">{t(locale, "settings", "theme")}</span>
            <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={onToggleDark}>
              {dark ? <Sun size={13} /> : <Moon size={13} />}
              {dark ? t(locale, "settings", "light") : t(locale, "settings", "dark")}
            </Button>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <span className="text-sm text-foreground">{t(locale, "settings", "autoLoad")}</span>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {locale === "cs" ? "Questy se nactou automaticky pri pohybu mapy" : "Quests load automatically when panning the map"}
              </p>
            </div>
            <button
              onClick={() => onToggleAutoLoad(!autoLoad)}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${autoLoad ? "bg-primary" : "bg-muted-foreground/30"}`}
              role="switch"
              aria-checked={autoLoad}
            >
              <span className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-md transition-transform ${autoLoad ? "translate-x-4" : "translate-x-0"}`} />
            </button>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <span className="text-sm text-foreground">{t(locale, "map", "layerSwitcher")}</span>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {mapLayer === "aerial" ? t(locale, "map", "aerial") : t(locale, "map", "standard")}
              </p>
            </div>
            <Badge variant={mapLayer === "aerial" ? "default" : "secondary"} className="text-xs">
              {mapLayer === "aerial" ? t(locale, "map", "aerial") : t(locale, "map", "standard")}
            </Badge>
          </div>
        </section>

        <Separator />

        <section className="flex flex-col gap-3">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t(locale, "settings", "cacheInfo")}</h3>
          <div className="rounded-lg border border-border bg-muted/30 p-3 flex flex-col gap-1.5">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">{locale === "cs" ? "Cachovane dlazdice" : "Cached tiles"}</span>
              <span className="font-mono text-foreground">{cacheStats.tiles}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">{locale === "cs" ? "Cachovane prvky" : "Cached elements"}</span>
              <span className="font-mono text-foreground">{cacheStats.items}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">TTL</span>
              <span className="font-mono text-foreground">5 min</span>
            </div>
          </div>
          <Button variant="outline" size="sm" className="w-full text-xs gap-1.5 text-destructive hover:text-destructive" onClick={onClearCache}>
            <Trash2 size={13} />
            {t(locale, "settings", "clearCache")}
          </Button>
        </section>

        <Separator />

        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t(locale, "settings", "about")}</h3>
          <p className="text-xs text-muted-foreground leading-relaxed">
            GeoComplete v1.0 — {locale === "cs"
              ? "Webova verze StreetComplete pro prispivani do OpenStreetMap."
              : "A web version of StreetComplete for contributing to OpenStreetMap."}
          </p>
          <div className="flex gap-2 flex-wrap">
            <a href="https://wiki.openstreetmap.org/wiki/StreetComplete" target="_blank" rel="noopener noreferrer"
              className="text-xs text-primary hover:underline">StreetComplete Wiki</a>
            <span className="text-muted-foreground text-xs">·</span>
            <a href="https://www.openstreetmap.org" target="_blank" rel="noopener noreferrer"
              className="text-xs text-primary hover:underline">OpenStreetMap.org</a>
          </div>
        </section>
      </div>
    </ScrollArea>
  );
}
