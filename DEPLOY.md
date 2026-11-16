# Deployment notes

The app is a fully static frontend. It generates a campaign analysis prompt in the browser; the user pastes it into ChatGPT manually. There are no server-side components, no API calls, and no secrets in the repository.

## Local validation

    npm.cmd test
    npm.cmd run build

The build output is `dist/`. GitHub Actions runs the tests and build on changes to `main` and pull requests targeting `main`.

## Deploying

Any static host works. Serve the contents of `dist/` with the root route pointing at `dist/index.html`. No environment variables, bindings, or build step are required on the host.

## Legacy Cloudflare resources

The repository previously contained a Cloudflare Worker with Pages Functions, KV namespaces, Durable Objects, and secrets. All of that code and local configuration was removed from the repository in November 2026; the app no longer uses any of it.

Status after the v2 cutover (2026-11-17):

- v2 is live on Cloudflare Pages project `meta-ads-planner`: https://meta-ads-planner.pages.dev and https://ads-planner.teckhub.net (deployed via `wrangler pages deploy dist --project-name meta-ads-planner`).
- The legacy Worker `meta-ads-planner-apicopy` was deleted. The old `/api/submit` endpoint no longer exists.
- Remaining account-level leftovers, deleted manually when no longer needed:
  - KV namespace `ADS_PLANNER_KV` (`3d500e63351848689b46bb0bc0d01fca`) — holds legacy v1 submission data.
  - The Cloudflare Access application gating `ads-planner.teckhub.net` (Zero Trust dashboard) — remove it only if the site should be public.
