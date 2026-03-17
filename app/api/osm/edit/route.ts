import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { neon } from "@neondatabase/serverless";

const OSM_API = "https://api.openstreetmap.org/api/0.6";
// Close a pooled changeset after 30 minutes of inactivity, or 100 edits
const CHANGESET_MAX_AGE_MS = 30 * 60 * 1000;
const CHANGESET_MAX_EDITS = 100;

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

async function getOrCreateChangeset(
  token: string,
  osmUserId: number,
  questTypeId: string,
  sql: ReturnType<typeof neon>
): Promise<string> {
  // Use questTypeId in comment so different quest types get separate changesets
  const comment = `GeoComplete: ${questTypeId}`;

  // 1. Find a recent open changeset for this user+questTypeId combo
  const rows = await sql`
    SELECT id, changeset_id, edit_count, last_used_at
    FROM changeset_pool
    WHERE osm_user_id = ${osmUserId}
      AND comment = ${comment}
      AND closed = FALSE
      AND last_used_at > NOW() - INTERVAL '30 minutes'
      AND edit_count < ${CHANGESET_MAX_EDITS}
    ORDER BY last_used_at DESC
    LIMIT 1
  `;

  if (rows.length > 0) {
    const row = rows[0];
    // Bump edit count and last_used_at
    await sql`
      UPDATE changeset_pool
      SET edit_count = edit_count + 1, last_used_at = NOW()
      WHERE id = ${row.id}
    `;
    return row.changeset_id as string;
  }

  // 2. Create a fresh changeset on OSM
  const changesetXml = `<osm><changeset>
    <tag k="created_by" v="GeoComplete Web 1.0"/>
    <tag k="comment" v="${escapeXml(comment)}"/>
    <tag k="source" v="survey"/>
  </changeset></osm>`;

  const csRes = await fetch(`${OSM_API}/changeset/create`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/xml" },
    body: changesetXml,
  });

  if (!csRes.ok) throw new Error(`Changeset create failed: ${csRes.status} ${await csRes.text()}`);
  const changesetId = (await csRes.text()).trim();

  // 3. Persist in pool
  await sql`
    INSERT INTO changeset_pool (osm_user_id, changeset_id, comment, edit_count)
    VALUES (${osmUserId}, ${changesetId}, ${comment}, 1)
  `;

  return changesetId;
}

async function closeStaleChangesets(osmUserId: number, sql: ReturnType<typeof neon>, token: string) {
  // Mark old stale changesets as closed in DB (OSM auto-closes them after 1h anyway)
  const stale = await sql`
    SELECT changeset_id FROM changeset_pool
    WHERE osm_user_id = ${osmUserId}
      AND closed = FALSE
      AND last_used_at < NOW() - INTERVAL '30 minutes'
  `;
  for (const row of stale) {
    try {
      await fetch(`${OSM_API}/changeset/${row.changeset_id}/close`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch { /* best-effort */ }
  }
  if (stale.length > 0) {
    await sql`
      UPDATE changeset_pool SET closed = TRUE
      WHERE osm_user_id = ${osmUserId}
        AND closed = FALSE
        AND last_used_at < NOW() - INTERVAL '30 minutes'
    `;
  }
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
    const { elementType, elementId, tag, value, comment, lat, lon, questTypeId } = body;

    // 1. Fetch current OSM element
    const elementRes = await fetch(`${OSM_API}/${elementType}/${elementId}.json`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!elementRes.ok) {
      return NextResponse.json({ error: "Failed to fetch element" }, { status: 400 });
    }
    const elementData = await elementRes.json();
    const element = elementData.elements[0];

    // 2. Get or create pooled changeset (async close stale ones first)
    await closeStaleChangesets(osmUser.id, sql, token);
    const changesetId = await getOrCreateChangeset(token, osmUser.id, questTypeId || "custom", sql);

    // 3. Build updated tag set
    const tags: Record<string, string> = { ...(element.tags || {}) };
    tags[tag] = value;

    const tagXml = Object.entries(tags)
      .map(([k, v]) => `<tag k="${escapeXml(k)}" v="${escapeXml(v as string)}"/>`)
      .join("\n");

    let updateXml: string;
    if (elementType === "node") {
      updateXml = `<osm><node id="${elementId}" changeset="${changesetId}" version="${element.version}" lat="${element.lat}" lon="${element.lon}">\n${tagXml}\n</node></osm>`;
    } else if (elementType === "way") {
      const ndRefs = (element.nodes ?? []).map((n: number) => `<nd ref="${n}"/>`).join("\n");
      updateXml = `<osm><way id="${elementId}" changeset="${changesetId}" version="${element.version}">\n${ndRefs}\n${tagXml}\n</way></osm>`;
    } else {
      const memberXml = (element.members ?? [])
        .map((m: { type: string; ref: number; role: string }) => `<member type="${m.type}" ref="${m.ref}" role="${escapeXml(m.role)}"/>`)
        .join("\n");
      updateXml = `<osm><relation id="${elementId}" changeset="${changesetId}" version="${element.version}">\n${memberXml}\n${tagXml}\n</relation></osm>`;
    }

    // 4. Push update to OSM
    const updateRes = await fetch(`${OSM_API}/${elementType}/${elementId}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/xml" },
      body: updateXml,
    });
    if (!updateRes.ok) {
      const errText = await updateRes.text();
      // If changeset is closed on OSM side, mark it in DB and retry once
      if (updateRes.status === 409 && errText.includes("closed")) {
        await sql`UPDATE changeset_pool SET closed = TRUE WHERE changeset_id = ${changesetId}`;
        const freshId = await getOrCreateChangeset(token, osmUser.id, questTypeId || "custom", sql);
        const retryXml = updateXml.replace(new RegExp(`changeset="${changesetId}"`, "g"), `changeset="${freshId}"`);
        const retry = await fetch(`${OSM_API}/${elementType}/${elementId}`, {
          method: "PUT",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/xml" },
          body: retryXml,
        });
        if (!retry.ok) {
          return NextResponse.json({ error: "Failed to update element", detail: await retry.text() }, { status: 400 });
        }
      } else {
        return NextResponse.json({ error: "Failed to update element", detail: errText }, { status: 400 });
      }
    }

    // 5. Record contribution in DB
    await sql`
      INSERT INTO contributions
        (osm_user_id, username, quest_type_id, element_type, element_id, tag, value, changeset_id, lat, lon)
      VALUES
        (${osmUser.id}, ${osmUser.display_name}, ${questTypeId ?? tag},
         ${elementType}, ${String(elementId)}, ${tag}, ${value},
         ${changesetId}, ${lat ?? null}, ${lon ?? null})
    `;

    // 6. Upsert leaderboard_cache for all-time, weekly, daily
    const periods = ["all", "weekly", "daily"] as const;
    for (const period of periods) {
      await sql`
        INSERT INTO leaderboard_cache (period, osm_user_id, username, total)
        VALUES (${period}, ${osmUser.id}, ${osmUser.display_name}, 1)
        ON CONFLICT (period, osm_user_id)
        DO UPDATE SET total = leaderboard_cache.total + 1,
                      username = EXCLUDED.username,
                      updated_at = NOW()
      `;
    }

    return NextResponse.json({ success: true, changesetId, elementType, elementId, tag, value });
  } catch (error) {
    console.error("Edit error:", error);
    return NextResponse.json({ error: "Internal server error", detail: String(error) }, { status: 500 });
  }
}
