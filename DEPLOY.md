# Deployment and production migration notes

This repository's v2 application is a static frontend built into `dist/`. It generates a campaign analysis prompt in the browser and links to ChatGPT for the user to paste manually.

## Local validation

    npm.cmd test
    npm.cmd run build

The build output is `dist/`. GitHub Actions runs the tests and build on changes to `main` and pull requests targeting `main`.

## Production migration

The local implementation does not deploy or change production hosting. Before a separately approved production migration:

1. Review the v2 form and prompt output.
2. Confirm the static host serves the built `dist/` assets and that the root route points to the v2 `index.html`.
3. Confirm the user-facing privacy notice matches the intended hosting and retention behavior.
4. Verify production behavior after the approved release using the hosting provider's normal checks.

The legacy Cloudflare Worker, Pages Function, bindings, KV namespaces, Durable Object resources, and secrets are outside the static v2 build. Removing repository code does not delete or alter those deployed resources or secrets. Assess their status separately after production traffic has migrated; do not delete them as part of this repository change.

This change has not been deployed. The production website continues to follow its existing hosting and release configuration until a future approved migration.
