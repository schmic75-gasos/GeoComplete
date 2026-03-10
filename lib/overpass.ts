import type { QuestItem } from "./store";
import type { QuestType } from "./quest-types";

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

export const MIN_ZOOM_FOR_LOAD = 14;

export interface BBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

// ─── Tile-based spatial cache ────────────────────────────────────────────────
// We snap the world into 0.05° tiles and cache per-tile, so zooming in never
// re-requests data already in memory. TTL = 10 minutes.
const TILE_DEG = 0.05;
const CACHE_TTL = 10 * 60 * 1000;
const LS_KEY = "gc_quest_cache_v3";

interface TileEntry {
  items: QuestItem[];
  questTypeIds: string[];
  ts: number;
}

const tileStore = new Map<string, TileEntry>();

// Load persisted cache from localStorage on first import
try {
  const raw = typeof window !== "undefined" ? localStorage.getItem(LS_KEY) : null;
  if (raw) {
    const parsed = JSON.parse(raw) as Record<string, TileEntry>;
    const now = Date.now();
    for (const [k, v] of Object.entries(parsed)) {
      if (v.ts + CACHE_TTL > now) tileStore.set(k, v);
    }
  }
} catch { /* ignore */ }

function persistCache() {
  try {
    if (typeof window === "undefined") return;
    const obj: Record<string, TileEntry> = {};
    const now = Date.now();
    for (const [k, v] of tileStore.entries()) {
      if (v.ts + CACHE_TTL > now) obj[k] = v;
    }
    localStorage.setItem(LS_KEY, JSON.stringify(obj));
  } catch { /* ignore quota */ }
}

function bboxToTileKeys(bbox: BBox): string[] {
  const keys: string[] = [];
  const s = Math.floor(bbox.south / TILE_DEG);
  const w = Math.floor(bbox.west / TILE_DEG);
  const n = Math.ceil(bbox.north / TILE_DEG);
  const e = Math.ceil(bbox.east / TILE_DEG);
  for (let row = s; row < n; row++) {
    for (let col = w; col < e; col++) {
      keys.push(`${row}:${col}`);
    }
  }
  return keys;
}

function tileToBBox(key: string): BBox {
  const [r, c] = key.split(":").map(Number);
  return {
    south: r * TILE_DEG,
    west: c * TILE_DEG,
    north: (r + 1) * TILE_DEG,
    east: (c + 1) * TILE_DEG,
  };
}

/** Returns which tiles are uncached (or stale) for the given quest type set */
function getMissingTiles(bbox: BBox, questTypeIds: string[]): string[] {
  const keys = bboxToTileKeys(bbox);
  const idsKey = [...questTypeIds].sort().join(",");
  const now = Date.now();
  return keys.filter((k) => {
    const e = tileStore.get(k);
    if (!e) return true;
    if (e.ts + CACHE_TTL < now) { tileStore.delete(k); return true; }
    // Same quest types already cached
    if ([...e.questTypeIds].sort().join(",") === idsKey) return false;
    return true;
  });
}

/** Pull all cached items for the bbox from tile store */
function getCachedItems(bbox: BBox, questTypeIds: string[]): QuestItem[] {
  const keys = bboxToTileKeys(bbox);
  const seen = new Set<string>();
  const items: QuestItem[] = [];
  for (const k of keys) {
    const e = tileStore.get(k);
    if (!e) continue;
    for (const it of e.items) {
      if (!questTypeIds.includes(it.questTypeId)) continue;
      const uid = `${it.questTypeId}-${it.id}`;
      if (!seen.has(uid)) { seen.add(uid); items.push(it); }
    }
  }
  return items;
}

/** Store fetched items into tile store */
function storeTileItems(missingKeys: string[], allItems: QuestItem[], questTypeIds: string[]) {
  const now = Date.now();
  for (const k of missingKeys) {
    const tb = tileToBBox(k);
    const inTile = allItems.filter(
      (it) => it.lat >= tb.south && it.lat < tb.north && it.lon >= tb.west && it.lon < tb.east
    );
    tileStore.set(k, { items: inTile, questTypeIds: [...questTypeIds], ts: now });
  }
  persistCache();
}

export function clearQuestCache() {
  tileStore.clear();
  try { localStorage.removeItem(LS_KEY); } catch { /* */ }
}

export function getCacheStats() {
  let items = 0;
  const now = Date.now();
  for (const e of tileStore.values()) {
    if (e.ts + CACHE_TTL > now) items += e.items.length;
  }
  return { tiles: tileStore.size, items };
}

// ─── Zoom / size guard ───────────────────────────────────────────────────────
export function isBBoxTooLarge(bbox: BBox): boolean {
  const lat = bbox.north - bbox.south;
  const lon = bbox.east - bbox.west;
  return lat > 0.15 || lon > 0.3; // roughly zoom < 14
}

// ─── Endpoint rotation ───────────────────────────────────────────────────────
let endpointIdx = 0;
function nextEndpoint() {
  const ep = OVERPASS_ENDPOINTS[endpointIdx % OVERPASS_ENDPOINTS.length];
  endpointIdx++;
  return ep;
}

// ─── In-flight dedup ─────────────────────────────────────────────────────────
const inflight = new Map<string, Promise<QuestItem[]>>();

// ─── Main fetch ──────────────────────────────────────────────────────────────
export async function fetchQuests(
  bbox: BBox,
  questTypes: QuestType[],
  limit = 120
): Promise<QuestItem[]> {
  if (isBBoxTooLarge(bbox)) return [];
  const ids = questTypes.map((q) => q.id);
  const inflightKey = `${JSON.stringify(bbox)}|${ids.sort().join(",")}`;

  // Return in-flight promise to avoid duplicate requests
  if (inflight.has(inflightKey)) return inflight.get(inflightKey)!;

  const missingKeys = getMissingTiles(bbox, ids);

  if (missingKeys.length === 0) {
    return getCachedItems(bbox, ids);
  }

  // Only fetch the bounding box of missing tiles
  const missingBBox: BBox = missingKeys.reduce<BBox>(
    (acc, k) => {
      const tb = tileToBBox(k);
      return {
        south: Math.min(acc.south, tb.south),
        west: Math.min(acc.west, tb.west),
        north: Math.max(acc.north, tb.north),
        east: Math.max(acc.east, tb.east),
      };
    },
    { south: Infinity, west: Infinity, north: -Infinity, east: -Infinity }
  );

  const promise = (async () => {
    const bboxStr = `${missingBBox.south},${missingBBox.west},${missingBBox.north},${missingBBox.east}`;
    const queries = questTypes.map((qt) => qt.overpassQuery.replace(/\{\{bbox\}\}/g, bboxStr));

    const fullQuery = `[out:json][timeout:28];\n(\n  ${queries.join("\n  ")}\n);\nout center ${limit};`;

    let lastErr: Error | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const endpoint = nextEndpoint();
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: `data=${encodeURIComponent(fullQuery)}`,
          signal: AbortSignal.timeout(32_000),
        });
        if (res.status === 429 || res.status === 503) {
          // Try next endpoint on next attempt
          await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
          continue;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data = await res.json();
        const fetched: QuestItem[] = [];

        for (const el of data.elements ?? []) {
          const lat = el.lat ?? el.center?.lat;
          const lon = el.lon ?? el.center?.lon;
          if (lat == null || lon == null) continue;
          for (const qt of questTypes) {
            if (matchesQuestType(el, qt)) {
              fetched.push({
                id: el.id,
                type: el.type,
                lat,
                lon,
                tags: el.tags ?? {},
                questTypeId: qt.id,
                elementType: el.type as "node" | "way" | "relation",
              });
              break;
            }
          }
        }

        storeTileItems(missingKeys, fetched, ids);
        // Merge fresh fetched with already-cached items for the full bbox
        return getCachedItems(bbox, ids);
      } catch (err) {
        lastErr = err instanceof Error ? err : new Error(String(err));
      }
    }
    throw lastErr ?? new Error("All endpoints failed");
  })();

  inflight.set(inflightKey, promise);
  promise.finally(() => inflight.delete(inflightKey));
  return promise;
}

// ─── Quest matching ──────────────────────────────────────────────────────────
// This is the client-side filter that determines if an element ACTUALLY needs
// this quest. It must match the overpass filter AND not already have the tag.
function matchesQuestType(el: Record<string, unknown>, qt: QuestType): boolean {
  const tags = (el.tags ?? {}) as Record<string, string>;
  const type = el.type as string;

  // Already has the primary tag → skip
  if (tags[qt.osmTag]) return false;

  switch (qt.id) {
    case "surface":
      return type === "way" && !!tags.highway && !tags.surface;
    case "backrest":
      return tags.amenity === "bench" && !tags.backrest;
    case "seats":
      return tags.amenity === "bench" && !tags.seats;
    case "opening_hours":
      return (!!tags.shop || ["restaurant","cafe","fast_food","bar","pub","pharmacy","bank","post_office"].includes(tags.amenity)) && !tags.opening_hours;
    case "wheelchair":
      return (!!tags.shop || ["restaurant","cafe","fast_food","bar","pub","pharmacy","bank","post_office","hospital","clinic"].includes(tags.amenity)) && !tags.wheelchair;
    case "building_levels":
      return type === "way" && !!tags.building && !tags["building:levels"];
    case "maxspeed":
      return type === "way" && ["residential","tertiary","secondary","primary","trunk"].includes(tags.highway) && !tags.maxspeed;
    case "sidewalk":
      return type === "way" && ["residential","tertiary","secondary","primary"].includes(tags.highway) && !tags.sidewalk && !tags["sidewalk:left"] && !tags["sidewalk:right"] && !tags["sidewalk:both"];
    case "crossing_type":
      return tags.highway === "crossing" && !tags.crossing;
    case "building_material":
      return type === "way" && !!tags.building && !tags["building:material"];
    case "roof_shape":
      return type === "way" && !!tags.building && !tags["roof:shape"];
    case "cuisine":
      return ["restaurant","fast_food"].includes(tags.amenity) && !tags.cuisine;
    case "internet_access":
      return ["cafe","restaurant","library","coworking_space"].includes(tags.amenity) && !tags.internet_access;
    case "smoking":
      return ["restaurant","cafe","fast_food","bar","pub"].includes(tags.amenity) && !tags.smoking;
    case "lit":
      return type === "way" && !!tags.highway && !tags.lit;
    case "tactile_paving":
      return tags.highway === "crossing" && !tags.tactile_paving;
    case "lane_count":
      return type === "way" && ["tertiary","secondary","primary","trunk","motorway"].includes(tags.highway) && !tags.lanes;
    case "oneway":
      return type === "way" && ["residential","tertiary","secondary","primary","unclassified","living_street"].includes(tags.highway) && !tags.oneway;
    case "cycleway":
      return type === "way" && ["residential","tertiary","secondary","primary"].includes(tags.highway) && !tags.cycleway && !tags["cycleway:left"] && !tags["cycleway:right"] && !tags["cycleway:both"];
    case "handrail":
      return type === "way" && tags.highway === "steps" && !tags.handrail;
    case "toilets_wheelchair":
      return tags.amenity === "toilets" && !tags.wheelchair;
    case "diet_vegetarian":
      return ["restaurant","cafe","fast_food"].includes(tags.amenity) && !tags["diet:vegetarian"];
    case "outdoor_seating":
      return ["restaurant","cafe","bar","pub"].includes(tags.amenity) && !tags.outdoor_seating;
    case "fee":
      return ["parking","toilets"].includes(tags.amenity) && !tags.fee;
    case "access":
      return tags.amenity === "parking" && !tags.access;
    case "phone":
      return ["pharmacy","hospital","clinic","police","fire_station"].includes(tags.amenity) && !tags.phone;
    case "website":
      return !!tags.shop && !tags.website && !tags["contact:website"];
    case "step_count":
      return type === "way" && tags.highway === "steps" && !tags.step_count;
    case "shelter":
      return ["bus_stop","taxi"].includes(tags.amenity) && !tags.shelter;
    case "bicycle_parking_type":
      return tags.amenity === "bicycle_parking" && !tags.bicycle_parking;
    case "name":
      return (!!tags.shop || !!tags.amenity || !!tags.office) && !tags.name;
    case "operator":
      return ["bicycle_rental","car_sharing","atm","bank"].includes(tags.amenity) && !tags.operator;
    case "bin":
      return tags.amenity === "waste_basket" && !tags.bin;
    default:
      return false;
  }
}

// Re-export QuestType for use in other modules
export type { QuestType };
