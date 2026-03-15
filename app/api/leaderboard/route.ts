import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { neon } from "@neondatabase/serverless";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const period = searchParams.get("period") ?? "all"; // "all" | "weekly" | "daily"
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "25"), 50);

  const sql = neon(process.env.DATABASE_URL!);

  try {
    // Reset daily/weekly caches at start of day/week
    // (simple approach: filter by updated_at)
    let rows;
    if (period === "daily") {
      rows = await sql`
        SELECT lc.osm_user_id, lc.username,
               COUNT(c.id)::int AS total,
               COALESCE(lc.total, 0) AS cached_total
        FROM contributions c
        JOIN leaderboard_cache lc ON lc.osm_user_id = c.osm_user_id AND lc.period = 'daily'
        WHERE c.created_at >= CURRENT_DATE
        GROUP BY lc.osm_user_id, lc.username, lc.total
        ORDER BY total DESC
        LIMIT ${limit}
      `;
    } else if (period === "weekly") {
      rows = await sql`
        SELECT lc.osm_user_id, lc.username,
               COUNT(c.id)::int AS total
        FROM contributions c
        JOIN leaderboard_cache lc ON lc.osm_user_id = c.osm_user_id AND lc.period = 'weekly'
        WHERE c.created_at >= DATE_TRUNC('week', CURRENT_DATE)
        GROUP BY lc.osm_user_id, lc.username
        ORDER BY total DESC
        LIMIT ${limit}
      `;
    } else {
      // all-time
      rows = await sql`
        SELECT osm_user_id, username, total
        FROM leaderboard_cache
        WHERE period = 'all'
        ORDER BY total DESC
        LIMIT ${limit}
      `;
    }

    // Also get the calling user's rank if authenticated
    const cookieStore = await cookies();
    const userJson = cookieStore.get("osm_user")?.value;
    let myRank: number | null = null;
    let myTotal = 0;

    if (userJson) {
      try {
        const osmUser = JSON.parse(userJson);
        const myRow = await sql`
          SELECT total FROM leaderboard_cache
          WHERE period = ${period} AND osm_user_id = ${osmUser.id}
        `;
        myTotal = myRow[0]?.total ?? 0;

        if (myTotal > 0) {
          const rankRow = await sql`
            SELECT COUNT(*)::int AS rank
            FROM leaderboard_cache
            WHERE period = ${period} AND total > ${myTotal}
          `;
          myRank = (rankRow[0]?.rank ?? 0) + 1;
        }
      } catch { /* unauthenticated */ }
    }

    return NextResponse.json({
      period,
      entries: rows.map((r, i) => ({
        rank: i + 1,
        username: r.username,
        osmUserId: r.osm_user_id,
        total: r.total,
      })),
      myRank,
      myTotal,
    });
  } catch (error) {
    console.error("Leaderboard error:", error);
    return NextResponse.json({ error: "Database error", detail: String(error) }, { status: 500 });
  }
}
