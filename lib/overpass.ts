import type { QuestItem } from "./store";
import type { QuestType } from "./quest-types";

const OVERPASS_API = "https://overpass-api.de/api/interpreter";
export const MIN_ZOOM_FOR_LOAD = 13;

export interface BBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

// --- In-memory tile cache ---
// We tile the world into ~0.1° cells and cache results per cell+questType set key.
const CACHE_CELL_SIZE = 0.05; // degrees; ~5km at mid-latitudes
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CacheEntry {
  items: QuestItem[];
  expires: number;
}

const tileCache = new Map<string, CacheEntry>();

function bboxToCacheKey(bbox: BBox, questTypeIds: string[]): string {
  // Snap bbox to grid cells
  const s = Math.floor(bbox.south / CACHE_CELL_SIZE);
  const w = Math.floor(bbox.west / CACHE_CELL_SIZE);
  const n = Math.ceil(bbox.north / CACHE_CELL_SIZE);
  const e = Math.ceil(bbox.east / CACHE_CELL_SIZE);
  return `${s},${w},${n},${e}|${questTypeIds.sort().join(",")}`;
}

export function getCachedQuests(bbox: BBox, questTypeIds: string[]): QuestItem[] | null {
  const key = bboxToCacheKey(bbox, questTypeIds);
  const entry = tileCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires) {
    tileCache.delete(key);
    return null;
  }
  return entry.items;
}

export function setCachedQuests(bbox: BBox, questTypeIds: string[], items: QuestItem[]) {
  const key = bboxToCacheKey(bbox, questTypeIds);
  tileCache.set(key, { items, expires: Date.now() + CACHE_TTL_MS });
}

export function clearQuestCache() {
  tileCache.clear();
}

export function getCacheStats() {
  let total = 0;
  const now = Date.now();
  for (const entry of tileCache.values()) {
    if (entry.expires > now) total += entry.items.length;
  }
  return { tiles: tileCache.size, items: total };
}

// --- Zoom guard ---
export function isBBoxTooLarge(bbox: BBox): boolean {
  const latSpan = bbox.north - bbox.south;
  const lonSpan = bbox.east - bbox.west;
  // Corresponds roughly to zoom < 13
  return latSpan > 0.2 || lonSpan > 0.4;
}

export async function fetchQuests(
  bbox: BBox,
  questTypes: QuestType[],
  limit: number = 100
): Promise<QuestItem[]> {
  if (isBBoxTooLarge(bbox)) {
    return [];
  }

  const ids = questTypes.map((qt) => qt.id);
  const cached = getCachedQuests(bbox, ids);
  if (cached) return cached;

  const bboxStr = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;

  const queries = questTypes.map((qt) => {
    return qt.overpassQuery.replace(/\{\{bbox\}\}/g, bboxStr);
  });

  const fullQuery = `
    [out:json][timeout:30];
    (
      ${queries.join("\n      ")}
    );
    out center ${limit};
  `;

  const response = await fetch(OVERPASS_API, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `data=${encodeURIComponent(fullQuery)}`,
  });

  if (!response.ok) {
    throw new Error(`Overpass API error: ${response.status}`);
  }

  const data = await response.json();
  const items: QuestItem[] = [];

  for (const element of data.elements || []) {
    const lat = element.lat ?? element.center?.lat;
    const lon = element.lon ?? element.center?.lon;
    if (lat === undefined || lon === undefined) continue;

    for (const qt of questTypes) {
      if (matchesQuestType(element, qt)) {
        items.push({
          id: element.id,
          type: element.type,
          lat,
          lon,
          tags: element.tags || {},
          questTypeId: qt.id,
          elementType: element.type as "node" | "way" | "relation",
        });
        break;
      }
    }
  }

  setCachedQuests(bbox, ids, items);
  return items;
}

function matchesQuestType(element: Record<string, unknown>, qt: QuestType): boolean {
  const tags = (element.tags || {}) as Record<string, string>;
  const type = element.type as string;

  if (tags[qt.osmTag]) return false;

  switch (qt.id) {
    case "surface":
      return type === "way" && !!tags.highway && !tags.surface;
    case "backrest":
      return tags.amenity === "bench" && !tags.backrest;
    case "opening_hours":
      return (!!tags.shop || ["restaurant", "cafe", "fast_food", "bar", "pub", "pharmacy", "bank", "post_office"].includes(tags.amenity)) && !tags.opening_hours;
    case "wheelchair":
      return (!!tags.shop || ["restaurant", "cafe", "fast_food", "bar", "pub", "pharmacy", "bank", "post_office", "hospital", "clinic"].includes(tags.amenity)) && !tags.wheelchair;
    case "building_levels":
      return !!tags.building && !tags["building:levels"];
    case "maxspeed":
      return type === "way" && !!tags.highway && !tags.maxspeed;
    case "sidewalk":
      return type === "way" && ["residential", "tertiary", "secondary", "primary"].includes(tags.highway) && !tags.sidewalk;
    case "crossing_type":
      return tags.highway === "crossing" && !tags.crossing;
    case "building_material":
      return !!tags.building && !tags["building:material"];
    case "roof_shape":
      return !!tags.building && !tags["roof:shape"];
    case "cuisine":
      return ["restaurant", "fast_food"].includes(tags.amenity) && !tags.cuisine;
    case "internet_access":
      return ["cafe", "restaurant", "library"].includes(tags.amenity) && !tags.internet_access;
    case "smoking":
      return ["restaurant", "cafe", "fast_food", "bar", "pub"].includes(tags.amenity) && !tags.smoking;
    case "lit":
      return type === "way" && !!tags.highway && !tags.lit;
    case "tactile_paving":
      return tags.highway === "crossing" && !tags.tactile_paving;
    case "lane_count":
      return type === "way" && ["tertiary", "secondary", "primary", "trunk", "motorway"].includes(tags.highway) && !tags.lanes;
    case "oneway":
      return type === "way" && ["residential", "tertiary", "secondary", "primary", "unclassified", "living_street"].includes(tags.highway) && !tags.oneway;
    case "cycleway":
      return type === "way" && ["residential", "tertiary", "secondary", "primary"].includes(tags.highway) && !tags.cycleway;
    case "handrail":
      return type === "way" && tags.highway === "steps" && !tags.handrail;
    case "toilets_wheelchair":
      return tags.amenity === "toilets" && !tags.wheelchair;
    case "diet_vegetarian":
      return ["restaurant", "cafe", "fast_food"].includes(tags.amenity) && !tags["diet:vegetarian"];
    case "outdoor_seating":
      return ["restaurant", "cafe", "bar", "pub"].includes(tags.amenity) && !tags.outdoor_seating;
    case "fee":
      return ["parking", "toilets"].includes(tags.amenity) && !tags.fee;
    case "access":
      return tags.amenity === "parking" && !tags.access;
    case "phone":
      return ["pharmacy", "hospital", "clinic", "police", "fire_station"].includes(tags.amenity) && !tags.phone;
    case "website":
      return !!tags.shop && !tags.website && !tags["contact:website"];
    case "capacity_bench":
      return tags.amenity === "bench" && !tags.capacity;
    case "step_count":
      return type === "way" && tags.highway === "steps" && !tags.step_count;
    case "shelter":
      return ["bus_stop", "taxi"].includes(tags.amenity) && !tags.shelter;
    case "bicycle_parking_type":
      return tags.amenity === "bicycle_parking" && !tags.bicycle_parking;
    default:
      return false;
  }
}
