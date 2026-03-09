import { NextResponse } from "next/server";

const OSM_CLIENT_ID = "zza_yThNU9D9VjO0RFneNdj059_ucN_mBvvHPTxVRos";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const origin = searchParams.get("origin") || new URL(request.url).origin;

  const redirectUri = `${origin}/api/osm/callback`;
  const scope = "read_prefs write_api write_changeset_comments write_gpx write_notes openid";

  const state = crypto.randomUUID();

  const authUrl = new URL("https://www.openstreetmap.org/oauth2/authorize");
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", OSM_CLIENT_ID);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", scope);
  authUrl.searchParams.set("state", state);

  const response = NextResponse.redirect(authUrl.toString());
  response.cookies.set("osm_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });

  return response;
}
