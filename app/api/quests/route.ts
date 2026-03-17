import { neon } from '@neondatabase/serverless';
import { cookies } from 'next/headers';
import { fetchQuests as fetchQuestsOverpass } from '@/lib/overpass';
import type { QuestItem } from '@/lib/store';
import { QUEST_TYPES } from '@/lib/quest-types';

const sql = neon(process.env.DATABASE_URL!);
const CACHE_TTL = 60 * 60 * 1000; // 60 minutes

export async function POST(req: Request) {
  try {
    const { bounds, questTypes } = await req.json();
    if (!bounds || !questTypes?.length) {
      return Response.json({ error: 'Missing bounds or questTypes' }, { status: 400 });
    }

    // Generate bbox key for cache lookup
    const bboxKey = `${Math.round(bounds.south * 1000)},${Math.round(bounds.west * 1000)},${Math.round(bounds.north * 1000)},${Math.round(bounds.east * 1000)}`;

    // 1. Get user ID from session if authenticated (for filtering skipped/solved)
    const cookieStore = await cookies();
    const userJson = cookieStore.get('osm_user')?.value;
    let osmUserId: number | null = null;
    
    if (userJson) {
      try {
        const user = JSON.parse(userJson);
        osmUserId = user.id;
      } catch {
        // Silent fail — will proceed without user filtering
      }
    }

    // 2. Fetch cached quests for this bbox + types
    const cached = await sql`
      SELECT * FROM quests_cache
      WHERE bbox_key = ${bboxKey}
        AND quest_type_id = ANY(${questTypes})
        AND created_at > NOW() - INTERVAL '60 minutes'
    `;

    let quests: QuestItem[] = cached.map((row: any) => ({
      id: row.element_id,
      questTypeId: row.quest_type_id,
      elementType: row.element_type,
      lat: row.lat,
      lon: row.lon,
      ...row.data,
    }));

    // If cache is empty or incomplete, fetch from Overpass and cache
    if (quests.length === 0) {
      const activeTypes = QUEST_TYPES.filter((qt) => questTypes.includes(qt.id));
      const overpassQuests = await fetchQuestsOverpass(bounds, activeTypes, 150);
      quests = overpassQuests;

      // Cache these quests
      for (const q of overpassQuests) {
        const qt = QUEST_TYPES.find((t) => t.id === q.questTypeId);
        if (!qt) continue;
        await sql`
          INSERT INTO quests_cache (bbox_key, quest_type_id, element_id, element_type, lat, lon, data)
          VALUES (${bboxKey}, ${q.questTypeId}, ${q.id}, ${q.elementType}, ${q.lat}, ${q.lon}, ${JSON.stringify({ ...q, id: undefined, questTypeId: undefined, elementType: undefined, lat: undefined, lon: undefined })})
          ON CONFLICT (bbox_key, quest_type_id, element_id) DO NOTHING
        `;
      }
    }

    // 3. Filter out skipped/solved quests for this user
    if (osmUserId) {
      const skipped = await sql`
        SELECT element_id FROM user_skipped_quests
        WHERE osm_user_id = ${osmUserId}
      `;
      const skippedIds = new Set(skipped.map((s: any) => s.element_id));

      const solved = await sql`
        SELECT element_id FROM user_solved_quests
        WHERE osm_user_id = ${osmUserId}
      `;
      const solvedIds = new Set(solved.map((s: any) => s.element_id));

      quests = quests.filter((q) => !skippedIds.has(q.id) && !solvedIds.has(q.id));
    }

    return Response.json({ quests, cached: cached.length > 0 });
  } catch (err) {
    console.error('[api/quests]', err);
    return Response.json({ error: 'Failed to fetch quests' }, { status: 500 });
  }
}
