import { neon } from '@neondatabase/serverless';
import { cookies } from 'next/headers';

const sql = neon(process.env.DATABASE_URL!);

export async function POST(req: Request) {
  try {
    const cookieStore = await cookies();
    const userJson = cookieStore.get('osm_user')?.value;
    
    if (!userJson) {
      return Response.json({ error: 'Not authenticated' }, { status: 401 });
    }

    let osmUserId: number;
    try {
      const user = JSON.parse(userJson);
      osmUserId = user.id;
    } catch {
      return Response.json({ error: 'Invalid user session' }, { status: 401 });
    }

    const { questTypeId, elementId } = await req.json();
    if (!questTypeId || !elementId) {
      return Response.json({ error: 'Missing questTypeId or elementId' }, { status: 400 });
    }

    // Insert skip record
    await sql`
      INSERT INTO user_skipped_quests (osm_user_id, quest_type_id, element_id)
      VALUES (${osmUserId}, ${questTypeId}, ${elementId})
      ON CONFLICT (osm_user_id, quest_type_id, element_id) DO NOTHING
    `;

    return Response.json({ skipped: true });
  } catch (err) {
    console.error('[api/user/skip-quest]', err);
    return Response.json({ error: 'Failed to skip quest' }, { status: 500 });
  }
}
