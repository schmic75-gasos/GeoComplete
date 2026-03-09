import type { QuestItem } from "./store";
import type { QuestType } from "./quest-types";

const OVERPASS_API = "https://overpass-api.de/api/interpreter";

export interface BBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

export async function fetchQuests(
  bbox: BBox,
  questTypes: QuestType[],
  limit: number = 50
): Promise<QuestItem[]> {
  const bboxStr = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;

  const queries = questTypes.map((qt) => {
    const q = qt.overpassQuery.replace(/\{\{bbox\}\}/g, bboxStr);
    return q;
  });

  const fullQuery = `
    [out:json][timeout:25];
    (
      ${queries.join("\n      ")}
    );
    out center ${limit};
  `;

  const response = await fetch(OVERPASS_API, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `data=${encodeURIComponent(fullQuery)}`,
  });

  if (!response.ok) {
    throw new Error(`Overpass API error: ${response.status}`);
  }

  const data = await response.json();

  const items: QuestItem[] = [];

  for (const element of data.elements || []) {
    const lat = element.lat ?? element.center?.lat;
    const lon = element.lon ?? element.center?.lon;

    if (lat === undefined || lon === undefined) continue;

    // Determine which quest type this element matches
    for (const qt of questTypes) {
      if (matchesQuestType(element, qt)) {
        items.push({
          id: element.id,
          type: element.type,
          lat,
          lon,
          tags: element.tags || {},
          questTypeId: qt.id,
          elementType: element.type as "node" | "way" | "relation",
        });
        break;
      }
    }
  }

  return items;
}

function matchesQuestType(element: Record<string, unknown>, qt: QuestType): boolean {
  const tags = (element.tags || {}) as Record<string, string>;
  const type = element.type as string;

  // Check the element doesn't already have the tag we're looking for
  if (tags[qt.osmTag]) return false;

  switch (qt.id) {
    case "surface":
      return type === "way" && !!tags.highway && !tags.surface;
    case "backrest":
      return tags.amenity === "bench" && !tags.backrest;
    case "opening_hours":
      return (!!tags.shop || ["restaurant", "cafe", "fast_food", "bar", "pub", "pharmacy", "bank", "post_office"].includes(tags.amenity)) && !tags.opening_hours;
    case "wheelchair":
      return (!!tags.shop || !!tags.amenity) && !tags.wheelchair;
    case "building_levels":
      return !!tags.building && !tags["building:levels"];
    case "maxspeed":
      return type === "way" && !!tags.highway && !tags.maxspeed;
    case "sidewalk":
      return type === "way" && ["residential", "tertiary", "secondary", "primary"].includes(tags.highway) && !tags.sidewalk;
    case "crossing_type":
      return tags.highway === "crossing" && !tags.crossing;
    case "building_material":
      return !!tags.building && !tags["building:material"];
    case "roof_shape":
      return !!tags.building && !tags["roof:shape"];
    case "cuisine":
      return ["restaurant", "fast_food"].includes(tags.amenity) && !tags.cuisine;
    case "internet_access":
      return ["cafe", "restaurant", "library"].includes(tags.amenity) && !tags.internet_access;
    case "smoking":
      return ["restaurant", "cafe", "fast_food", "bar", "pub"].includes(tags.amenity) && !tags.smoking;
    case "lit":
      return type === "way" && !!tags.highway && !tags.lit;
    case "tactile_paving":
      return tags.highway === "crossing" && !tags.tactile_paving;
    default:
      return false;
  }
}
