export async function onRequestPost({ request, env }) {
  const url = new URL(request.url);

  if (url.pathname !== "/api/submit") {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const accessHeader = request.headers.get("Cf-Access-Jwt-Assertion");
const cookies = request.headers.get("Cookie") || "";

const accessCookie = cookies
  .split(";")
  .map(cookie => cookie.trim())
  .find(cookie => cookie.startsWith("CF_Authorization="));

const token = accessHeader ||
  (accessCookie ? accessCookie.slice("CF_Authorization=".length) : null);

  // Fail closed if Cloudflare Access did not supply an application JWT.
  if (!token) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!env.PLANNER_API) {
    return Response.json(
      { error: "API service unavailable" },
      { status: 503 }
    );
  }

  const headers = new Headers();
  headers.set("Content-Type", request.headers.get("Content-Type") || "");
  headers.set("Cf-Access-Jwt-Assertion", token);
  headers.set("Origin", url.origin);

  const upstream = new Request(
    "https://meta-ads-planner-apicopy.abbasbitar68.workers.dev/submit",
    {
      method: "POST",
      headers,
      body: request.body,
      duplex: "half",
      redirect: "manual"
    }
  );

  return env.PLANNER_API.fetch(upstream);
}
