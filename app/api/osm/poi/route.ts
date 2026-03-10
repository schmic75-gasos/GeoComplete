import { NextResponse } from "next/server";
import { cookies } from "next/headers";

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

  if (!token) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

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

    // 1. Create changeset
    const changesetComment = comment || `Add POI via GeoComplete`;
    const changesetXml = `<osm><changeset>
  <tag k="created_by" v="GeoComplete Web 1.0"/>
  <tag k="comment" v="${escapeXml(changesetComment)}"/>
  <tag k="source" v="survey"/>
</changeset></osm>`;

    const csRes = await fetch(`${OSM_API}/changeset/create`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/xml",
      },
      body: changesetXml,
    });

    if (!csRes.ok) {
      const errText = await csRes.text();
      return NextResponse.json({ error: "Failed to create changeset", detail: errText }, { status: 400 });
    }

    const changesetId = (await csRes.text()).trim();

    // 2. Create node
    const tagXml = Object.entries(tags)
      .filter(([, v]) => v && v.trim())
      .map(([k, v]) => `  <tag k="${escapeXml(k)}" v="${escapeXml(v)}"/>`)
      .join("\n");

    const nodeXml = `<osm>
  <node changeset="${changesetId}" lat="${lat}" lon="${lon}">
${tagXml}
  </node>
</osm>`;

    const nodeRes = await fetch(`${OSM_API}/node/create`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/xml",
      },
      body: nodeXml,
    });

    if (!nodeRes.ok) {
      const errText = await nodeRes.text();
      // Close changeset to keep OSM clean
      await fetch(`${OSM_API}/changeset/${changesetId}/close`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}` },
      });
      return NextResponse.json({ error: "Failed to create node", detail: errText }, { status: 400 });
    }

    const newNodeId = (await nodeRes.text()).trim();

    // 3. Close changeset
    await fetch(`${OSM_API}/changeset/${changesetId}/close`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}` },
    });

    return NextResponse.json({ success: true, nodeId: newNodeId, changesetId });
  } catch (error) {
    console.error("POI create error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
