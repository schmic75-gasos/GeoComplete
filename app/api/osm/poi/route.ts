import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { neon } from "@neondatabase/serverless";

const OSM_API = "https://api.openstreetmap.org/api/0.6";

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const token = cookieStore.get("osm_token")?.value;
  const userJson = cookieStore.get("osm_user")?.value;

  if (!token || !userJson) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let osmUser: { id: number; display_name: string };
  try {
    osmUser = JSON.parse(userJson);
  } catch {
    return NextResponse.json({ error: "Invalid user session" }, { status: 401 });
  }

  const sql = neon(process.env.DATABASE_URL!);

  try {
    const body = await request.json();
    const { lat, lon, tags, comment } = body as {
      lat: number;
      lon: number;
      tags: Record<string, string>;
      comment?: string;
    };

    if (!lat || !lon || !tags) {
      return NextResponse.json({ error: "lat, lon and tags are required" }, { status: 400 });
    }

    // 1. Reuse the changeset pool (same logic as edit route)
    const rows = await sql`
      SELECT changeset_id FROM changeset_pool
      WHERE osm_user_id = ${osmUser.id}
        AND closed = FALSE
        AND last_used_at > NOW() - INTERVAL '30 minutes'
        AND edit_count < 100
      ORDER BY last_used_at DESC LIMIT 1
    `;

    let changesetId: string;
    const changesetComment = comment || `Add POI via GeoComplete`;

    if (rows.length > 0) {
      changesetId = rows[0].changeset_id as string;
      await sql`UPDATE changeset_pool SET edit_count = edit_count + 1, last_used_at = NOW()
                WHERE changeset_id = ${changesetId}`;
    } else {
      const csXml = `<osm><changeset>
  <tag k="created_by" v="GeoComplete Web 1.0"/>
  <tag k="comment" v="${escapeXml(changesetComment)}"/>
  <tag k="source" v="survey"/>
</changeset></osm>`;
      const csRes = await fetch(`${OSM_API}/changeset/create`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/xml" },
        body: csXml,
      });
      if (!csRes.ok) {
        return NextResponse.json({ error: "Failed to create changeset", detail: await csRes.text() }, { status: 400 });
      }
      changesetId = (await csRes.text()).trim();
      await sql`INSERT INTO changeset_pool (osm_user_id, changeset_id, comment, edit_count)
                VALUES (${osmUser.id}, ${changesetId}, ${changesetComment}, 1)`;
    }

    // 2. Create OSM node
    const tagXml = Object.entries(tags)
      .filter(([, v]) => v?.trim())
      .map(([k, v]) => `  <tag k="${escapeXml(k)}" v="${escapeXml(v)}"/>`)
      .join("\n");

    const nodeXml = `<osm>\n  <node changeset="${changesetId}" lat="${lat}" lon="${lon}">\n${tagXml}\n  </node>\n</osm>`;

    const nodeRes = await fetch(`${OSM_API}/node/create`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/xml" },
      body: nodeXml,
    });

    if (!nodeRes.ok) {
      return NextResponse.json({ error: "Failed to create node", detail: await nodeRes.text() }, { status: 400 });
    }
    const newNodeId = (await nodeRes.text()).trim();

    // 3. Record in contributions + bump leaderboard
    const primaryTag = Object.keys(tags)[0] ?? "poi";
    await sql`
      INSERT INTO contributions (osm_user_id, username, quest_type_id, element_type, element_id, tag, value, changeset_id, lat, lon)
      VALUES (${osmUser.id}, ${osmUser.display_name}, ${"add_poi"}, ${"node"}, ${newNodeId}, ${primaryTag}, ${tags[primaryTag] ?? ""}, ${changesetId}, ${lat}, ${lon})
    `;
    for (const period of ["all", "weekly", "daily"]) {
      await sql`
        INSERT INTO leaderboard_cache (period, osm_user_id, username, total)
        VALUES (${period}, ${osmUser.id}, ${osmUser.display_name}, 1)
        ON CONFLICT (period, osm_user_id)
        DO UPDATE SET total = leaderboard_cache.total + 1, username = EXCLUDED.username, updated_at = NOW()
      `;
    }

    return NextResponse.json({ success: true, nodeId: newNodeId, changesetId });
  } catch (error) {
    console.error("POI create error:", error);
    return NextResponse.json({ error: "Internal server error", detail: String(error) }, { status: 500 });
  }
}
