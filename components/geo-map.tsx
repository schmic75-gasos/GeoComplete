"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import type { QuestItem, OsmNote } from "@/lib/store";
import type { QuestType } from "@/lib/quest-types";
import { QUEST_TYPES } from "@/lib/quest-types";

declare global {
  interface Window {
    L: typeof import("leaflet");
  }
}

interface GeoMapProps {
  quests: QuestItem[];
  notes: OsmNote[];
  showNotes: boolean;
  selectedQuest: QuestItem | null;
  onSelectQuest: (quest: QuestItem | null) => void;
  onSelectNote: (note: OsmNote | null) => void;
  onBoundsChange: (bounds: { south: number; west: number; north: number; east: number }) => void;
  onMapClick: (lat: number, lon: number) => void;
  creatingNote: boolean;
}

function getQuestColor(questTypeId: string): string {
  const qt = QUEST_TYPES.find((q) => q.id === questTypeId);
  return qt?.color || "#888";
}

function createQuestIcon(L: typeof import("leaflet"), questTypeId: string): import("leaflet").DivIcon {
  const color = getQuestColor(questTypeId);
  return L.divIcon({
    className: "quest-marker",
    html: `<div style="
      width: 28px; height: 28px; border-radius: 50%; 
      background: ${color}; border: 3px solid white;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
      display: flex; align-items: center; justify-content: center;
      cursor: pointer; transition: transform 0.15s;
    "><div style="width: 8px; height: 8px; border-radius: 50%; background: white;"></div></div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

function createSelectedQuestIcon(L: typeof import("leaflet"), questTypeId: string): import("leaflet").DivIcon {
  const color = getQuestColor(questTypeId);
  return L.divIcon({
    className: "quest-marker-selected",
    html: `<div style="
      width: 38px; height: 38px; border-radius: 50%; 
      background: ${color}; border: 3px solid #FFD700;
      box-shadow: 0 0 16px rgba(255,215,0,0.6), 0 4px 12px rgba(0,0,0,0.3);
      display: flex; align-items: center; justify-content: center;
      cursor: pointer; animation: pulse 1.5s ease-in-out infinite;
    "><div style="width: 10px; height: 10px; border-radius: 50%; background: white;"></div></div>`,
    iconSize: [38, 38],
    iconAnchor: [19, 19],
  });
}

function createNoteIcon(L: typeof import("leaflet"), status: "open" | "closed"): import("leaflet").DivIcon {
  const color = status === "open" ? "#E74C3C" : "#95A5A6";
  return L.divIcon({
    className: "note-marker",
    html: `<div style="
      width: 24px; height: 24px; border-radius: 4px; 
      background: ${color}; border: 2px solid white;
      box-shadow: 0 2px 6px rgba(0,0,0,0.3);
      display: flex; align-items: center; justify-content: center;
      cursor: pointer; transform: rotate(45deg);
    "><div style="width: 6px; height: 6px; background: white; transform: rotate(-45deg);"></div></div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}

export default function GeoMap({
  quests,
  notes,
  showNotes,
  selectedQuest,
  onSelectQuest,
  onSelectNote,
  onBoundsChange,
  onMapClick,
  creatingNote,
}: GeoMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<import("leaflet").Map | null>(null);
  const questLayerRef = useRef<import("leaflet").LayerGroup | null>(null);
  const noteLayerRef = useRef<import("leaflet").LayerGroup | null>(null);
  const [mapReady, setMapReady] = useState(false);

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
        center: [50.0755, 14.4378], // Prague default
        zoom: 15,
        zoomControl: false,
      });

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19,
      }).addTo(map);

      L.control.zoom({ position: "bottomright" }).addTo(map);

      const questLayer = L.layerGroup().addTo(map);
      const noteLayer = L.layerGroup().addTo(map);

      questLayerRef.current = questLayer;
      noteLayerRef.current = noteLayer;
      mapInstanceRef.current = map;

      // Report bounds on move
      const reportBounds = () => {
        const bounds = map.getBounds();
        onBoundsChange({
          south: bounds.getSouth(),
          west: bounds.getWest(),
          north: bounds.getNorth(),
          east: bounds.getEast(),
        });
      };

      map.on("moveend", reportBounds);
      map.on("click", (e: import("leaflet").LeafletMouseEvent) => {
        onMapClick(e.latlng.lat, e.latlng.lng);
      });

      // Try geolocation
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            map.setView([pos.coords.latitude, pos.coords.longitude], 16);
          },
          () => {
            // Use default (Prague)
            reportBounds();
          }
        );
      } else {
        reportBounds();
      }

      setTimeout(reportBounds, 500);
      setMapReady(true);
    };
    document.head.appendChild(script);

    return () => {
      // Cleanup not needed for single-page app
    };
  }, []);

  // Update quest markers
  useEffect(() => {
    if (!mapReady || !questLayerRef.current || !window.L) return;

    const L = window.L;
    questLayerRef.current.clearLayers();

    quests.forEach((quest) => {
      const isSelected = selectedQuest?.id === quest.id && selectedQuest?.questTypeId === quest.questTypeId;
      const icon = isSelected
        ? createSelectedQuestIcon(L, quest.questTypeId)
        : createQuestIcon(L, quest.questTypeId);

      const marker = L.marker([quest.lat, quest.lon], { icon });
      marker.on("click", () => {
        onSelectQuest(quest);
      });
      questLayerRef.current!.addLayer(marker);
    });
  }, [quests, selectedQuest, mapReady]);

  // Update note markers
  useEffect(() => {
    if (!mapReady || !noteLayerRef.current || !window.L) return;

    const L = window.L;
    noteLayerRef.current.clearLayers();

    if (!showNotes) return;

    notes.forEach((note) => {
      const icon = createNoteIcon(L, note.status);
      const marker = L.marker([note.lat, note.lon], { icon });
      marker.on("click", () => {
        onSelectNote(note);
      });
      noteLayerRef.current!.addLayer(marker);
    });
  }, [notes, showNotes, mapReady]);

  // Pan to selected quest
  useEffect(() => {
    if (selectedQuest && mapInstanceRef.current) {
      mapInstanceRef.current.panTo([selectedQuest.lat, selectedQuest.lon], {
        animate: true,
        duration: 0.3,
      });
    }
  }, [selectedQuest]);

  // Update cursor for note creation mode
  useEffect(() => {
    if (mapRef.current) {
      mapRef.current.style.cursor = creatingNote ? "crosshair" : "";
    }
  }, [creatingNote]);

  const handleLocate = useCallback(() => {
    if (!mapInstanceRef.current || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition((pos) => {
      mapInstanceRef.current!.setView(
        [pos.coords.latitude, pos.coords.longitude],
        17,
        { animate: true }
      );
    });
  }, []);

  return (
    <div className="relative h-full w-full">
      <div ref={mapRef} className="h-full w-full" />
      {mapReady && (
        <button
          onClick={handleLocate}
          className="absolute bottom-24 right-3 z-[1000] flex h-9 w-9 items-center justify-center rounded-md bg-card text-card-foreground shadow-lg border border-border hover:bg-secondary transition-colors"
          aria-label="Locate me"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
          </svg>
        </button>
      )}
      <style jsx global>{`
        .quest-marker, .quest-marker-selected, .note-marker {
          background: transparent !important;
          border: none !important;
        }
        @keyframes pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.15); }
        }
        .leaflet-control-zoom a {
          width: 34px !important;
          height: 34px !important;
          line-height: 34px !important;
          font-size: 16px !important;
          background: var(--card) !important;
          color: var(--card-foreground) !important;
          border-color: var(--border) !important;
        }
        .leaflet-control-zoom a:hover {
          background: var(--secondary) !important;
        }
        .leaflet-control-attribution {
          background: var(--card) !important;
          color: var(--muted-foreground) !important;
          font-size: 10px !important;
        }
        .leaflet-control-attribution a {
          color: var(--primary) !important;
        }
      `}</style>
    </div>
  );
}
