# Meta Ads Planner

Secure campaign intake portal for authorized Meta Ads representatives.

## Production architecture

- Website: https://ads-planner.teckhub.net
- Hosting: Cloudflare Pages (meta-ads-planner)
- Production branch: main
- Backend: Cloudflare Worker (meta-ads-planner-apicopy)
- Authentication: Cloudflare Access
- Bot protection: Cloudflare Turnstile
- Submission coordination: SQLite-backed Cloudflare Durable Object
- Rate limiting and migration fallback: Cloudflare KV (SUBMISSIONS)
- Notifications: Telegram

## Submission workflow

1. An authorized representative signs in through Cloudflare Access.
2. The representative completes the campaign intake form.
3. The frontend validates the information and verifies Turnstile.
4. A Cloudflare Pages Function forwards the authenticated submission to the Worker.
5. The Worker validates and processes the submission.
6. Telegram receives the campaign report and detailed caption.
7. The representative receives a submission reference.

The full report is not displayed to the representative.

## Development

Requirements: Node.js 22 or later and npm.

Run automated tests:

    npm test

Build the frontend:

    npm run build

Build output: dist/

## Deployment

Cloudflare Pages deploys frontend changes from the main branch.
The Worker is deployed separately through Wrangler.
See DEPLOY.md for production deployment and verification.

## Security

- Cloudflare Access restricts representative access.
- The Worker validates Access authentication and approved identities.
- Turnstile is bot protection, not authentication.
- Keep Telegram credentials and Turnstile secrets out of Git.
- Never collect passwords, payment card data, or unnecessary personal information.
- The Durable Object stores a canonical payload digest and submission state, not raw campaign data.
- Cloudflare KV remains a best-effort rate limiter; Durable Object storage coordinates submission retries.
- Campaign recommendations do not guarantee advertising results.

## CI/CD

GitHub Actions runs automated tests and validates the frontend build.
Cloudflare Pages hosts production. GitHub Pages is not used.

## Phase 3.2 targeting and rollout

The representative enters a free-text business type/industry, product/service and intended customer. The private Worker uses a conservative multilingual keyword catalog to suggest candidate interest and demographic search terms; unknown industries fall back to the supplied product phrase. These suggestions are **not** a live Meta Ads targeting catalog, and no LLM or Meta Marketing API lookup is performed. Confirm each option and Advantage+ behavior in Ads Manager.

The Telegram document uses Campaign → Ad Set → Ad sections and preserves the private objective decision. The frontend continues sending the legacy `category=Other` plus a free-text `description` field, so an older Worker can still accept new forms during a staged release. The new targeting/report features require deploying the Worker separately after merging. See DEPLOY.md. Do not mistake a passing Pages build for a Worker deployment.
