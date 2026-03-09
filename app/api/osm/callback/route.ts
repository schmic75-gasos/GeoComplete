import { NextResponse } from "next/server";

const OSM_CLIENT_ID = "zza_yThNU9D9VjO0RFneNdj059_ucN_mBvvHPTxVRos";
const OSM_CLIENT_SECRET = "LB2sPIlZpALlz-Y4yinzIJEiW8d369uNbBp8QPsaWoc";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const origin = url.origin;

  if (!code) {
    return NextResponse.redirect(`${origin}?error=no_code`);
  }

  const redirectUri = `${origin}/api/osm/callback`;

  try {
    const tokenResponse = await fetch("https://www.openstreetmap.org/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: OSM_CLIENT_ID,
        client_secret: OSM_CLIENT_SECRET,
      }),
    });

    if (!tokenResponse.ok) {
      const errText = await tokenResponse.text();
      console.error("Token exchange failed:", errText);
      return NextResponse.redirect(`${origin}?error=token_exchange_failed`);
    }

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;

    const userResponse = await fetch("https://api.openstreetmap.org/api/0.6/user/details.json", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!userResponse.ok) {
      return NextResponse.redirect(`${origin}?error=user_fetch_failed`);
    }

    const userData = await userResponse.json();
    const user = userData.user;

    const userInfo = JSON.stringify({
      id: user.id,
      display_name: user.display_name,
      img: user.img?.href || null,
      changesets_count: user.changesets?.count || 0,
      account_created: user.account_created,
    });

    const response = NextResponse.redirect(`${origin}?login=success`);
    response.cookies.set("osm_token", accessToken, {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 86400 * 30,
      path: "/",
    });
    response.cookies.set("osm_user", userInfo, {
      httpOnly: false,
      sameSite: "lax",
      maxAge: 86400 * 30,
      path: "/",
    });

    return response;
  } catch (error) {
    console.error("OAuth callback error:", error);
    return NextResponse.redirect(`${origin}?error=callback_failed`);
  }
}
