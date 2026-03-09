import { NextResponse } from "next/server";
import { cookies } from "next/headers";

const OSM_API = "https://api.openstreetmap.org/api/0.6";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const bbox = searchParams.get("bbox");
  const limit = searchParams.get("limit") || "100";
  const closed = searchParams.get("closed") || "7";

  if (!bbox) {
    return NextResponse.json({ error: "bbox required" }, { status: 400 });
  }

  try {
    const res = await fetch(
      `${OSM_API}/notes.json?bbox=${bbox}&limit=${limit}&closed=${closed}`,
      { next: { revalidate: 60 } }
    );

    if (!res.ok) {
      return NextResponse.json({ error: "Failed to fetch notes" }, { status: 400 });
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const token = cookieStore.get("osm_token")?.value;

  try {
    const body = await request.json();
    const { action, lat, lon, text, noteId, comment } = body;

    if (action === "create") {
      const url = token
        ? `${OSM_API}/notes.json`
        : `${OSM_API}/notes.json`;

      const params = new URLSearchParams({
        lat: lat.toString(),
        lon: lon.toString(),
        text,
      });

      const res = await fetch(`${url}?${params}`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      if (!res.ok) {
        const errText = await res.text();
        return NextResponse.json({ error: errText }, { status: 400 });
      }

      const data = await res.json();
      return NextResponse.json(data);
    }

    if (action === "comment") {
      if (!noteId) return NextResponse.json({ error: "noteId required" }, { status: 400 });

      const params = new URLSearchParams({ text: comment });
      const res = await fetch(
        `${OSM_API}/notes/${noteId}/comment.json?${params}`,
        {
          method: "POST",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        }
      );

      if (!res.ok) {
        const errText = await res.text();
        return NextResponse.json({ error: errText }, { status: 400 });
      }

      const data = await res.json();
      return NextResponse.json(data);
    }

    if (action === "close" || action === "reopen") {
      if (!token) {
        return NextResponse.json({ error: "Auth required" }, { status: 401 });
      }
      if (!noteId) return NextResponse.json({ error: "noteId required" }, { status: 400 });

      const endpoint = action === "close" ? "close" : "reopen";
      const params = comment ? new URLSearchParams({ text: comment }) : new URLSearchParams();
      const res = await fetch(
        `${OSM_API}/notes/${noteId}/${endpoint}.json?${params}`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      if (!res.ok) {
        const errText = await res.text();
        return NextResponse.json({ error: errText }, { status: 400 });
      }

      const data = await res.json();
      return NextResponse.json(data);
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
