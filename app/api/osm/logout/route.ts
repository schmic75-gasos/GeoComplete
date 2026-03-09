import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const origin = new URL(request.url).origin;
  const response = NextResponse.json({ success: true });
  response.cookies.set("osm_token", "", { maxAge: 0, path: "/" });
  response.cookies.set("osm_user", "", { maxAge: 0, path: "/" });
  return response;
}
