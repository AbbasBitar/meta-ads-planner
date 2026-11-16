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

Removing the code does not delete resources in the Cloudflare account. If the old Worker is still deployed there, decommission it manually from the Cloudflare dashboard:

1. Delete or disable the legacy Worker and its routes (including the old `/api/submit` endpoint).
2. Delete the associated KV namespaces and Durable Objects.
3. Rotate the `APPROVED_EMAILS` secret if it is still stored anywhere, since the feature that used it no longer exists.
4. Verify the live site serves the static `dist/` build (the page source references `?v=tracker-renames-v9` assets).
