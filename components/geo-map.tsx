"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import type { QuestItem, OsmNote } from "@/lib/store";
import type { Locale } from "@/lib/i18n";
import { t } from "@/lib/i18n";
import { QUEST_TYPES } from "@/lib/quest-types";
import { MIN_ZOOM_FOR_LOAD } from "@/lib/overpass";

declare global {
  interface Window {
    L: typeof import("leaflet");
  }
}

export type MapLayer = "standard" | "aerial";

interface GeoMapProps {
  quests: QuestItem[];
  notes: OsmNote[];
  showNotes: boolean;
  selectedQuest: QuestItem | null;
  selectedNote: OsmNote | null;
  onSelectQuest: (quest: QuestItem | null) => void;
  onSelectNote: (note: OsmNote | null) => void;
  onBoundsChange: (bounds: { south: number; west: number; north: number; east: number }, zoom: number) => void;
  onMapClick: (lat: number, lon: number) => void;
  creatingNote: boolean;
  mapLayer: MapLayer;
  onMapLayerChange: (layer: MapLayer) => void;
  locale: Locale;
}

function getQuestColor(questTypeId: string): string {
  return QUEST_TYPES.find((q) => q.id === questTypeId)?.color || "#888";
}

function createQuestIcon(L: typeof import("leaflet"), questTypeId: string, selected: boolean): import("leaflet").DivIcon {
  const color = getQuestColor(questTypeId);
  const size = selected ? 42 : 30;
  const inner = selected ? 12 : 8;
  const border = selected ? "3px solid #FFD700" : "2.5px solid rgba(255,255,255,0.9)";
  const shadow = selected
    ? "0 0 0 3px rgba(255,215,0,0.4), 0 4px 14px rgba(0,0,0,0.35)"
    : "0 2px 8px rgba(0,0,0,0.28)";
  const anim = selected ? "animation:gc-pulse 1.4s ease-in-out infinite;" : "";
  return L.divIcon({
    className: "",
    html: `<div style="
      width:${size}px;height:${size}px;border-radius:50%;
      background:${color};border:${border};
      box-shadow:${shadow};
      display:flex;align-items:center;justify-content:center;
      cursor:pointer;${anim}
      transition:transform 0.15s;
    "><div style="width:${inner}px;height:${inner}px;border-radius:50%;background:rgba(255,255,255,0.9);"></div></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    // Make the popup open above the marker
    popupAnchor: [0, -size / 2],
  });
}

function createNoteIcon(L: typeof import("leaflet"), status: "open" | "closed"): import("leaflet").DivIcon {
  const color = status === "open" ? "#E74C3C" : "#95A5A6";
  return L.divIcon({
    className: "",
    html: `<div style="
      width:22px;height:22px;border-radius:4px 4px 0 4px;
      background:${color};border:2px solid rgba(255,255,255,0.9);
      box-shadow:0 2px 6px rgba(0,0,0,0.3);
      display:flex;align-items:center;justify-content:center;
      cursor:pointer;transform:rotate(45deg);
    "><div style="width:5px;height:5px;background:rgba(255,255,255,0.9);border-radius:50%;transform:rotate(-45deg);"></div></div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

export default function GeoMap({
  quests,
  notes,
  showNotes,
  selectedQuest,
  selectedNote,
  onSelectQuest,
  onSelectNote,
  onBoundsChange,
  onMapClick,
  creatingNote,
  mapLayer,
  onMapLayerChange,
  locale,
}: GeoMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<import("leaflet").Map | null>(null);
  const questLayerRef = useRef<import("leaflet").LayerGroup | null>(null);
  const noteLayerRef = useRef<import("leaflet").LayerGroup | null>(null);
  const tileLayerRef = useRef<import("leaflet").TileLayer | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [currentZoom, setCurrentZoom] = useState(15);

  const TILE_URLS: Record<MapLayer, { url: string; attribution: string; maxZoom: number }> = {
    standard: {
      url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    },
    aerial: {
      url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      attribution: '&copy; <a href="https://www.esri.com/">Esri</a>, Maxar, GeoEye, Earthstar Geographics',
      maxZoom: 20,
    },
  };

  // Initialize map
  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
    document.head.appendChild(link);

    const script = document.createElement("script");
    script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    script.onload = () => {
      const L = window.L;
      if (!L || !mapRef.current) return;

      const map = L.map(mapRef.current, {
        center: [50.0755, 14.4378],
        zoom: 15,
        zoomControl: false,
        // Better touch handling
        tap: true,
        tapTolerance: 15,
      });

      const tl = L.tileLayer(TILE_URLS.standard.url, {
        attribution: TILE_URLS.standard.attribution,
        maxZoom: TILE_URLS.standard.maxZoom,
      }).addTo(map);

      tileLayerRef.current = tl;

      L.control.zoom({ position: "bottomright" }).addTo(map);

      const questLayer = L.layerGroup().addTo(map);
      const noteLayer = L.layerGroup().addTo(map);

      questLayerRef.current = questLayer;
      noteLayerRef.current = noteLayer;
      mapInstanceRef.current = map;

      const reportBounds = () => {
        const bounds = map.getBounds();
        const zoom = map.getZoom();
        setCurrentZoom(zoom);
        onBoundsChange({
          south: bounds.getSouth(),
          west: bounds.getWest(),
          north: bounds.getNorth(),
          east: bounds.getEast(),
        }, zoom);
      };

      map.on("moveend", reportBounds);
      map.on("zoomend", reportBounds);

      // Handle click/tap for note creation
      map.on("click", (e: import("leaflet").LeafletMouseEvent) => {
        onMapClick(e.latlng.lat, e.latlng.lng);
      });

      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            map.setView([pos.coords.latitude, pos.coords.longitude], 16);
          },
          () => { reportBounds(); }
        );
      } else {
        reportBounds();
      }

      setTimeout(reportBounds, 600);
      setMapReady(true);
    };
    document.head.appendChild(script);
  }, []);

  // Switch tile layer when mapLayer prop changes
  useEffect(() => {
    if (!mapReady || !mapInstanceRef.current || !window.L) return;
    const L = window.L;
    const map = mapInstanceRef.current;
    if (tileLayerRef.current) {
      map.removeLayer(tileLayerRef.current);
    }
    const cfg = TILE_URLS[mapLayer];
    const tl = L.tileLayer(cfg.url, {
      attribution: cfg.attribution,
      maxZoom: cfg.maxZoom,
    });
    tl.addTo(map);
    // Ensure tile layer is below marker layers
    tl.bringToBack();
    tileLayerRef.current = tl;
  }, [mapLayer, mapReady]);

  // Update quest markers - mobile: use click to open panel, not popup
  useEffect(() => {
    if (!mapReady || !questLayerRef.current || !window.L) return;
    const L = window.L;
    questLayerRef.current.clearLayers();

    quests.forEach((quest) => {
      const isSelected = selectedQuest?.id === quest.id && selectedQuest?.questTypeId === quest.questTypeId;
      const icon = createQuestIcon(L, quest.questTypeId, isSelected);
      const marker = L.marker([quest.lat, quest.lon], { icon, zIndexOffset: isSelected ? 1000 : 0 });

      // On mobile, a plain click should immediately fire onSelectQuest.
      // We intentionally do NOT use Leaflet popups here — the sidebar/bottom-sheet handles display.
      marker.on("click", (e: import("leaflet").LeafletMouseEvent) => {
        // Stop the click from propagating to the map (which would trigger onMapClick)
        e.originalEvent.stopPropagation();
        onSelectQuest(quest);
      });

      questLayerRef.current!.addLayer(marker);
    });
  }, [quests, selectedQuest, mapReady, onSelectQuest]);

  // Update note markers
  useEffect(() => {
    if (!mapReady || !noteLayerRef.current || !window.L) return;
    const L = window.L;
    noteLayerRef.current.clearLayers();
    if (!showNotes) return;

    notes.forEach((note) => {
      const icon = createNoteIcon(L, note.status);
      const marker = L.marker([note.lat, note.lon], { icon });
      marker.on("click", (e: import("leaflet").LeafletMouseEvent) => {
        e.originalEvent.stopPropagation();
        onSelectNote(note);
      });
      noteLayerRef.current!.addLayer(marker);
    });
  }, [notes, showNotes, mapReady, onSelectNote]);

  // Pan to selected quest
  useEffect(() => {
    if (selectedQuest && mapInstanceRef.current) {
      mapInstanceRef.current.panTo([selectedQuest.lat, selectedQuest.lon], {
        animate: true, duration: 0.4,
      });
    }
  }, [selectedQuest]);

  // Pan to selected note
  useEffect(() => {
    if (selectedNote && mapInstanceRef.current) {
      mapInstanceRef.current.panTo([selectedNote.lat, selectedNote.lon], {
        animate: true, duration: 0.4,
      });
    }
  }, [selectedNote]);

  // Cursor for note creation mode
  useEffect(() => {
    if (mapRef.current) {
      mapRef.current.style.cursor = creatingNote ? "crosshair" : "";
    }
  }, [creatingNote]);

  const handleLocate = useCallback(() => {
    if (!mapInstanceRef.current || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition((pos) => {
      mapInstanceRef.current!.setView([pos.coords.latitude, pos.coords.longitude], 17, { animate: true });
    });
  }, []);

  const zoomTooLow = currentZoom < MIN_ZOOM_FOR_LOAD;

  return (
    <div className="relative h-full w-full">
      <div ref={mapRef} className="h-full w-full" />

      {/* Zoom warning overlay */}
      {mapReady && zoomTooLow && (
        <div className="pointer-events-none absolute inset-x-0 bottom-32 flex justify-center z-[900]">
          <div className="bg-card/95 backdrop-blur border border-border rounded-lg px-4 py-2 shadow-md text-xs text-muted-foreground flex items-center gap-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
            </svg>
            {t(locale, "map", "zoomTooLow")}
          </div>
        </div>
      )}

      {/* Layer switcher button */}
      {mapReady && (
        <div className="absolute bottom-[7.5rem] right-3 z-[1000] flex flex-col gap-1">
          <button
            onClick={handleLocate}
            className="flex h-9 w-9 items-center justify-center rounded-md bg-card text-card-foreground shadow-md border border-border hover:bg-secondary transition-colors"
            aria-label={t(locale, "map", "locateMe")}
            title={t(locale, "map", "locateMe")}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" /><path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
            </svg>
          </button>
          <button
            onClick={() => onMapLayerChange(mapLayer === "standard" ? "aerial" : "standard")}
            className="flex h-9 w-9 items-center justify-center rounded-md bg-card text-card-foreground shadow-md border border-border hover:bg-secondary transition-colors"
            aria-label={t(locale, "map", "layerSwitcher")}
            title={mapLayer === "standard" ? t(locale, "map", "aerial") : t(locale, "map", "standard")}
          >
            {mapLayer === "standard" ? (
              /* Satellite icon */
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2a10 10 0 1 0 10 10"/><path d="M12 12 2.5 21"/><circle cx="19" cy="5" r="3"/>
              </svg>
            ) : (
              /* Map icon */
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"/>
                <line x1="9" y1="3" x2="9" y2="18"/><line x1="15" y1="6" x2="15" y2="21"/>
              </svg>
            )}
          </button>
        </div>
      )}

      {/* Layer badge */}
      {mapReady && mapLayer === "aerial" && (
        <div className="absolute top-3 right-3 z-[900] pointer-events-none">
          <span className="rounded px-2 py-0.5 text-[10px] font-medium bg-black/60 text-white backdrop-blur">
            {t(locale, "map", "aerial")}
          </span>
        </div>
      )}

      <style jsx global>{`
        @keyframes gc-pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.18); }
        }
        .leaflet-control-zoom a {
          width: 34px !important; height: 34px !important;
          line-height: 34px !important; font-size: 16px !important;
          background: var(--card) !important; color: var(--card-foreground) !important;
          border-color: var(--border) !important;
        }
        .leaflet-control-zoom a:hover { background: var(--secondary) !important; }
        .leaflet-control-attribution {
          background: var(--card) !important; color: var(--muted-foreground) !important;
          font-size: 10px !important; max-width: 280px !important;
        }
        .leaflet-control-attribution a { color: var(--primary) !important; }
        /* Prevent Leaflet from stealing touch scroll on mobile */
        .leaflet-container { -webkit-tap-highlight-color: transparent; }
      `}</style>
    </div>
  );
}
