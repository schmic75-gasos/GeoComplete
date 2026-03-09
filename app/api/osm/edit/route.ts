import { NextResponse } from "next/server";
import { cookies } from "next/headers";

const OSM_API = "https://api.openstreetmap.org/api/0.6";

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const token = cookieStore.get("osm_token")?.value;

  if (!token) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { elementType, elementId, tag, value, comment } = body;

    // 1. Get current element
    const elementUrl = `${OSM_API}/${elementType}/${elementId}.json`;
    const elementRes = await fetch(elementUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!elementRes.ok) {
      return NextResponse.json({ error: "Failed to fetch element" }, { status: 400 });
    }

    const elementData = await elementRes.json();
    const element = elementData.elements[0];

    // 2. Create changeset
    const changesetXml = `
      <osm>
        <changeset>
          <tag k="created_by" v="GeoComplete Web 1.0"/>
          <tag k="comment" v="${escapeXml(comment || `Add ${tag}=${value} via GeoComplete`)}"/>
          <tag k="source" v="survey"/>
        </changeset>
      </osm>
    `;

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

    const changesetId = await csRes.text();

    // 3. Update element with new tag
    const tags = element.tags || {};
    tags[tag] = value;

    let updateXml: string;

    if (elementType === "node") {
      const tagXml = Object.entries(tags)
        .map(([k, v]) => `<tag k="${escapeXml(k as string)}" v="${escapeXml(v as string)}"/>`)
        .join("\n      ");
      updateXml = `
        <osm>
          <node id="${elementId}" changeset="${changesetId}" version="${element.version}" lat="${element.lat}" lon="${element.lon}">
            ${tagXml}
          </node>
        </osm>
      `;
    } else if (elementType === "way") {
      const ndRefs = element.nodes?.map((n: number) => `<nd ref="${n}"/>`).join("\n      ") || "";
      const tagXml = Object.entries(tags)
        .map(([k, v]) => `<tag k="${escapeXml(k as string)}" v="${escapeXml(v as string)}"/>`)
        .join("\n      ");
      updateXml = `
        <osm>
          <way id="${elementId}" changeset="${changesetId}" version="${element.version}">
            ${ndRefs}
            ${tagXml}
          </way>
        </osm>
      `;
    } else {
      // relation
      const memberXml = element.members?.map((m: { type: string; ref: number; role: string }) =>
        `<member type="${m.type}" ref="${m.ref}" role="${escapeXml(m.role)}"/>`
      ).join("\n      ") || "";
      const tagXml = Object.entries(tags)
        .map(([k, v]) => `<tag k="${escapeXml(k as string)}" v="${escapeXml(v as string)}"/>`)
        .join("\n      ");
      updateXml = `
        <osm>
          <relation id="${elementId}" changeset="${changesetId}" version="${element.version}">
            ${memberXml}
            ${tagXml}
          </relation>
        </osm>
      `;
    }

    const updateRes = await fetch(`${OSM_API}/${elementType}/${elementId}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/xml",
      },
      body: updateXml,
    });

    if (!updateRes.ok) {
      const errText = await updateRes.text();
      return NextResponse.json({ error: "Failed to update element", detail: errText }, { status: 400 });
    }

    // 4. Close changeset
    await fetch(`${OSM_API}/changeset/${changesetId}/close`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}` },
    });

    return NextResponse.json({
      success: true,
      changesetId,
      elementType,
      elementId,
      tag,
      value,
    });
  } catch (error) {
    console.error("Edit error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
