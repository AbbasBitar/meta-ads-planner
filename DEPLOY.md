# Meta Ads Planner - Production Deployment

## Production infrastructure

- Website: https://ads-planner.teckhub.net
- Repository: https://github.com/AbbasBitar/meta-ads-planner
- Cloudflare Pages project: meta-ads-planner
- Production branch: main
- Cloudflare Worker: meta-ads-planner-apicopy
- Worker configuration: worker/wrangler.toml
- KV binding: SUBMISSIONS

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
- Namespace configured in worker/wrangler.toml

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
6. The Worker accepts a valid submission.
7. The representative receives a submission reference.
8. Telegram receives the report and detailed caption.

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
