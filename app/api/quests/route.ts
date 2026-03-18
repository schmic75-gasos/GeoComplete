import { neon } from '@neondatabase/serverless';
import { cookies } from 'next/headers';
import type { BBox } from '@/lib/overpass';
import type { QuestType } from '@/lib/quest-types';
import { QUEST_TYPES } from '@/lib/quest-types';
import type { QuestItem } from '@/lib/store';

const sql = neon(process.env.DATABASE_URL!);

// Match the same tile granularity as the client-side overpass.ts
const TILE_DEG = 0.05;
const TILE_TTL_HOURS = 24; // DB tiles are valid for 24 hours (much longer than client 1h)

// ─── Tile helpers (mirrored from lib/overpass.ts) ────────────────────────────
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
  const [r, c] = key.split(':').map(Number);
  return {
    south: r * TILE_DEG,
    west: c * TILE_DEG,
    north: (r + 1) * TILE_DEG,
    east: (c + 1) * TILE_DEG,
  };
}

function missingTilesBBox(keys: string[]): BBox {
  return keys.reduce<BBox>(
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
}

// ─── Overpass fetch (server-side, no client cache) ───────────────────────────
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];
let epIdx = 0;

async function fetchFromOverpass(fetchBBox: BBox, questTypes: QuestType[], limit = 200): Promise<QuestItem[]> {
  const bboxStr = `${fetchBBox.south},${fetchBBox.west},${fetchBBox.north},${fetchBBox.east}`;
  const queries = questTypes.map((qt) => qt.overpassQuery.replace(/\{\{bbox\}\}/g, bboxStr));
  const fullQuery = `[out:json][timeout:28];\n(\n  ${queries.join('\n  ')}\n);\nout center ${limit};`;

  for (let attempt = 0; attempt < OVERPASS_ENDPOINTS.length; attempt++) {
    const endpoint = OVERPASS_ENDPOINTS[epIdx % OVERPASS_ENDPOINTS.length];
    epIdx++;
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(fullQuery)}`,
        signal: AbortSignal.timeout(32_000),
      });
      if (res.status === 429 || res.status === 503) {
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      const items: QuestItem[] = [];
      for (const el of data.elements ?? []) {
        const lat = el.lat ?? el.center?.lat;
        const lon = el.lon ?? el.center?.lon;
        if (lat == null || lon == null) continue;
        for (const qt of questTypes) {
          if (matchesQuestType(el, qt)) {
            items.push({
              id: String(el.id),
              type: el.type,
              lat,
              lon,
              tags: el.tags ?? {},
              questTypeId: qt.id,
              elementType: el.type as 'node' | 'way' | 'relation',
            });
            break;
          }
        }
      }
      return items;
    } catch {
      // try next endpoint
    }
  }
  throw new Error('All Overpass endpoints failed');
}

// ─── Quest matching (mirrors lib/overpass.ts matchesQuestType) ───────────────
function matchesQuestType(el: Record<string, unknown>, qt: QuestType): boolean {
  const tags = (el.tags ?? {}) as Record<string, string>;
  const type = el.type as string;
  if (tags[qt.osmTag]) return false;
  switch (qt.id) {
    case 'surface': return type === 'way' && !!tags.highway && !tags.surface;
    case 'backrest': return tags.amenity === 'bench' && !tags.backrest;
    case 'seats': return tags.amenity === 'bench' && !tags.seats;
    case 'opening_hours': return (!!tags.shop || ['restaurant','cafe','fast_food','bar','pub','pharmacy','bank','post_office'].includes(tags.amenity)) && !tags.opening_hours;
    case 'wheelchair': return (!!tags.shop || ['restaurant','cafe','fast_food','bar','pub','pharmacy','bank','post_office','hospital','clinic'].includes(tags.amenity)) && !tags.wheelchair;
    case 'building_levels': return type === 'way' && !!tags.building && !tags['building:levels'];
    case 'maxspeed': return type === 'way' && ['residential','tertiary','secondary','primary','trunk'].includes(tags.highway) && !tags.maxspeed;
    case 'sidewalk': return type === 'way' && ['residential','tertiary','secondary','primary'].includes(tags.highway) && !tags.sidewalk && !tags['sidewalk:left'] && !tags['sidewalk:right'] && !tags['sidewalk:both'];
    case 'crossing_type': return tags.highway === 'crossing' && !tags.crossing;
    case 'building_material': return type === 'way' && !!tags.building && !tags['building:material'];
    case 'roof_shape': return type === 'way' && !!tags.building && !tags['roof:shape'];
    case 'cuisine': return ['restaurant','fast_food'].includes(tags.amenity) && !tags.cuisine;
    case 'internet_access': return ['cafe','restaurant','library','coworking_space'].includes(tags.amenity) && !tags.internet_access;
    case 'smoking': return ['restaurant','cafe','fast_food','bar','pub'].includes(tags.amenity) && !tags.smoking;
    case 'lit': return type === 'way' && !!tags.highway && !tags.lit;
    case 'tactile_paving': return tags.highway === 'crossing' && !tags.tactile_paving;
    case 'lane_count': return type === 'way' && ['tertiary','secondary','primary','trunk','motorway'].includes(tags.highway) && !tags.lanes;
    case 'oneway': return type === 'way' && ['residential','tertiary','secondary','primary','unclassified','living_street'].includes(tags.highway) && !tags.oneway;
    case 'cycleway': return type === 'way' && ['residential','tertiary','secondary','primary'].includes(tags.highway) && !tags.cycleway && !tags['cycleway:left'] && !tags['cycleway:right'] && !tags['cycleway:both'];
    case 'handrail': return type === 'way' && tags.highway === 'steps' && !tags.handrail;
    case 'toilets_wheelchair': return tags.amenity === 'toilets' && !tags.wheelchair;
    case 'diet_vegetarian': return ['restaurant','cafe','fast_food'].includes(tags.amenity) && !tags['diet:vegetarian'];
    case 'outdoor_seating': return ['restaurant','cafe','bar','pub'].includes(tags.amenity) && !tags.outdoor_seating;
    case 'fee': return ['parking','toilets'].includes(tags.amenity) && !tags.fee;
    case 'access': return tags.amenity === 'parking' && !tags.access;
    case 'phone': return ['pharmacy','hospital','clinic','police','fire_station'].includes(tags.amenity) && !tags.phone;
    case 'website': return !!tags.shop && !tags.website && !tags['contact:website'];
    case 'step_count': return type === 'way' && tags.highway === 'steps' && !tags.step_count;
    case 'shelter': return ['bus_stop','taxi'].includes(tags.amenity) && !tags.shelter;
    case 'bicycle_parking_type': return tags.amenity === 'bicycle_parking' && !tags.bicycle_parking;
    case 'name': return (!!tags.shop || !!tags.amenity || !!tags.office) && !tags.name;
    case 'operator': return ['bicycle_rental','car_sharing','atm','bank'].includes(tags.amenity) && !tags.operator;
    case 'bin': return tags.amenity === 'waste_basket' && !tags.bin;
    default: return false;
  }
}

// ─── Main route ──────────────────────────────────────────────────────────────
export async function POST(req: Request) {
  try {
    const { bounds, questTypes: questTypeIds } = await req.json() as {
      bounds: BBox;
      questTypes: string[];
    };

    if (!bounds || !questTypeIds?.length) {
      return Response.json({ error: 'Missing bounds or questTypes' }, { status: 400 });
    }

    // 1. Get user for filtering skipped/solved
    const cookieStore = await cookies();
    const userJson = cookieStore.get('osm_user')?.value;
    let osmUserId: number | null = null;
    if (userJson) {
      try { osmUserId = JSON.parse(userJson).id; } catch { /* silent */ }
    }

    // 2. Split bbox into tiles and determine which are cached vs missing
    const allTileKeys = bboxToTileKeys(bounds);
    const questTypesKey = [...questTypeIds].sort().join(',');

    // Check which tiles we have in DB (within TTL)
    const cachedTiles = await sql`
      SELECT DISTINCT tile_key FROM quests_cache
      WHERE tile_key = ANY(${allTileKeys})
        AND quest_types_key = ${questTypesKey}
        AND created_at > NOW() - INTERVAL '24 hours'
    `;
    const cachedTileSet = new Set(cachedTiles.map((r: any) => r.tile_key as string));
    const missingTileKeys = allTileKeys.filter((k) => !cachedTileSet.has(k));

    // 3. Fetch missing tiles from Overpass
    if (missingTileKeys.length > 0) {
      const fetchBBox = missingTilesBBox(missingTileKeys);
      const activeTypes = QUEST_TYPES.filter((qt) => questTypeIds.includes(qt.id));
      let fresh: QuestItem[] = [];

      try {
        fresh = await fetchFromOverpass(fetchBBox, activeTypes, 300);
      } catch (err) {
        console.error('[api/quests] Overpass fetch failed:', err);
        // Continue with whatever is cached — don't fail the whole request
      }

      // Store fresh items per tile in DB
      // First record empty tiles too so we don't re-fetch them
      const tileItemMap = new Map<string, QuestItem[]>();
      for (const key of missingTileKeys) tileItemMap.set(key, []);
      for (const q of fresh) {
        // Find which tile this item belongs to
        for (const key of missingTileKeys) {
          const tb = tileToBBox(key);
          if (q.lat >= tb.south && q.lat < tb.north && q.lon >= tb.west && q.lon < tb.east) {
            tileItemMap.get(key)!.push(q);
            break;
          }
        }
      }

      // Bulk upsert into DB
      for (const [tileKey, items] of tileItemMap) {
        // Upsert tile record
        await sql`
          INSERT INTO quests_cache (bbox_key, tile_key, quest_type_id, quest_types_key, element_id, element_type, lat, lon, data)
          SELECT
            ${tileKey},
            ${tileKey},
            item->>'questTypeId',
            ${questTypesKey},
            item->>'id',
            item->>'elementType',
            (item->>'lat')::float,
            (item->>'lon')::float,
            item - 'id' - 'questTypeId' - 'elementType' - 'lat' - 'lon'
          FROM jsonb_array_elements(${JSON.stringify(items.map(q => ({
            ...q,
            id: String(q.id),
            lat: q.lat,
            lon: q.lon,
          })))}::jsonb) AS item
          ON CONFLICT (bbox_key, quest_type_id, element_id) DO NOTHING
        `.catch(() => {
          // If bulk fails, insert individually
          return Promise.all(items.map((q) =>
            sql`
              INSERT INTO quests_cache (bbox_key, tile_key, quest_type_id, quest_types_key, element_id, element_type, lat, lon, data)
              VALUES (
                ${tileKey}, ${tileKey}, ${q.questTypeId}, ${questTypesKey},
                ${String(q.id)}, ${q.elementType}, ${q.lat}, ${q.lon},
                ${JSON.stringify({ tags: q.tags, type: q.type })}
              )
              ON CONFLICT (bbox_key, quest_type_id, element_id) DO NOTHING
            `.catch(() => null)
          ));
        });
      }
    }

    // 4. Fetch all items for requested tiles from DB
    const rows = await sql`
      SELECT element_id, quest_type_id, element_type, lat, lon, data
      FROM quests_cache
      WHERE tile_key = ANY(${allTileKeys})
        AND quest_type_id = ANY(${questTypeIds})
        AND created_at > NOW() - INTERVAL '24 hours'
    `;

    let quests: QuestItem[] = rows.map((row: any) => ({
      id: row.element_id,
      questTypeId: row.quest_type_id,
      elementType: row.element_type,
      lat: Number(row.lat),
      lon: Number(row.lon),
      tags: (row.data as any)?.tags ?? {},
      type: (row.data as any)?.type ?? row.element_type,
    }));

    // Deduplicate (same element can appear in multiple tiles at edges)
    const seen = new Set<string>();
    quests = quests.filter((q) => {
      const key = `${q.questTypeId}-${q.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // 5. Filter skipped/solved for authenticated users
    if (osmUserId) {
      const [skipped, solved] = await Promise.all([
        sql`SELECT element_id FROM user_skipped_quests WHERE osm_user_id = ${osmUserId}`,
        sql`SELECT element_id FROM user_solved_quests WHERE osm_user_id = ${osmUserId}`,
      ]);
      const excluded = new Set([
        ...skipped.map((s: any) => s.element_id as string),
        ...solved.map((s: any) => s.element_id as string),
      ]);
      quests = quests.filter((q) => !excluded.has(String(q.id)));
    }

    return Response.json({
      quests,
      tilesTotal: allTileKeys.length,
      tilesCached: cachedTileSet.size,
      tilesFetched: missingTileKeys.length,
    });
  } catch (err) {
    console.error('[api/quests]', err);
    return Response.json({ error: 'Failed to fetch quests' }, { status: 500 });
  }
}
