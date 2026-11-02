# Meta Ads Planner - Production Deployment

## Production infrastructure

- Website: https://ads-planner.teckhub.net
- Repository: https://github.com/AbbasBitar/meta-ads-planner
- Cloudflare Pages project: meta-ads-planner
- Production branch: main
- Cloudflare Worker: meta-ads-planner-apicopy
- Worker configuration: worker/wrangler.toml
- KV binding: SUBMISSIONS (best-effort rate limiting and legacy-state migration fallback)
- Durable Object binding: SUBMISSION_COORDINATOR (SQLite-backed submission coordination)

## Frontend deployment

Cloudflare Pages deploys automatically from the GitHub main branch.

Expected Pages configuration:

- Build command: npm run build
- Build output directory: dist
- Node.js version: 22

The functions/ directory contains the Pages API integration.

GitHub Pages is not used for production.

## Worker deployment

Run from the repository root:

    npm test
    npm run build
    npx wrangler deploy --config worker/wrangler.toml

Worker deployment is separate from Cloudflare Pages deployment.
Only deploy the Worker after validating intended source changes.

The Worker deploys with `SUBMISSIONS_PAUSED = "true"`. The API remains
protected by Cloudflare Access, but authenticated submissions receive HTTP
503 until an authorized operator explicitly enables them. There is no public
maintenance-mode endpoint.

### Controlled submission enablement

1. Deploy and verify the Worker while `SUBMISSIONS_PAUSED` is `"true"`.
2. Confirm the Durable Object migration/binding, required secrets, Access
   allowlist, Turnstile, Pages `PLANNER_API` service binding, and the paused
   503 response.
3. After release approval, an authorized operator changes
   `SUBMISSIONS_PAUSED = "true"` to `SUBMISSIONS_PAUSED = "false"` in
   `worker/wrangler.toml` and deploys that reviewed Worker configuration:

       npx wrangler@4.156.2 deploy --config worker/wrangler.toml

4. Verify the deployed setting and run the approved production smoke test.

To pause submissions during an incident, an authorized operator sets the
value back to `"true"` and deploys the Worker. Missing or any other value
fails closed with HTTP 503. The frontend preserves the pending submission ID
and shows the maintenance response; do not clear pending IDs to work around
the pause.

## Authentication and security

Cloudflare Access protects the production application.
The Pages Function and Worker enforce Access authentication.
The Worker also checks authorized representative identities.

Maintain the approved representative allowlist securely.
Do not disable Access or WAF rules during troubleshooting.

Turnstile provides bot protection, not user authentication.

The frontend Turnstile site key is configured in config.js.
The Worker requires the corresponding TURNSTILE_SECRET.

Store all credentials as Cloudflare Worker secrets.
Never commit credentials or authentication tokens.

## Required Worker resources

Cloudflare KV:

- Binding: SUBMISSIONS
- Namespace configured in worker/wrangler.toml; used for rate limiting and one-time migration fallback.

Durable Object:

- Binding: SUBMISSION_COORDINATOR
- Class: SubmissionCoordinator
- SQLite-backed namespace created by the `submission_coordinator_sqlite_20261102` `new_sqlite_classes` migration in worker/wrangler.toml.
- The first deployment of this migration provisions the namespace. Review Cloudflare Workers Free storage and operation quotas before deployment; do not assume usage beyond included quotas is free.
- Coordinator states are retained in SQLite to preserve idempotency. Do not delete the namespace or its data during routine cleanup.

## Telegram delivery reconciliation

When a submission returns `delivery_unknown`, the coordinator blocks automatic retries and the page displays the reference. The representative must contact the campaign owner with that reference. The owner checks Telegram for the matching document or caption. If it arrived, the representative should not resubmit. If it did not arrive, the representative can use the page's explicit confirmation action to create a new submission ID and try again.

Telegram secrets:

- TELEGRAM_BOT_TOKEN
- TELEGRAM_CHAT_ID

Additional authentication or application secrets must remain configured
according to the Worker source and Cloudflare environment.

## Production verification

Run:

    npm test
    npm run build
    npx wrangler pages deployment list --project-name meta-ads-planner
    npx wrangler deployments list --config worker/wrangler.toml

Verify:

1. Automated tests pass.
2. Cloudflare Pages production uses the intended main commit.
3. All frontend assets are present in dist/.
4. Cloudflare Access authenticates approved representatives.
5. Turnstile verification succeeds.
6. With maintenance enabled, authenticated `/submit` requests return HTTP 503
   and the frontend preserves the pending ID. Missing or invalid maintenance
   configuration also fails closed.
7. Only after the controlled enablement procedure, the Worker accepts an
   authorized valid submission.
8. The representative receives a submission reference and Telegram receives
   exactly one report with the detailed caption.

## Rollback and cleanup

Preserve previous Cloudflare deployments for rollback.
Do not delete production KV namespaces or Worker secrets.
Review Cloudflare Security Events when requests are blocked.
Do not store real customer reports in GitHub.

## CI/CD responsibilities

- GitHub Actions: automated tests and build verification.
- Cloudflare Pages: production frontend deployment from main.
- Wrangler: controlled Worker deployment.
- GitHub Pages: legacy hosting unpublished.
