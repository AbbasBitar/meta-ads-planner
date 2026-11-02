# Meta Ads Planner

Secure campaign intake portal for authorized Meta Ads representatives.

## Production architecture

- Website: https://ads-planner.teckhub.net
- Hosting: Cloudflare Pages (meta-ads-planner)
- Production branch: main
- Backend: Cloudflare Worker (meta-ads-planner-apicopy)
- Authentication: Cloudflare Access
- Bot protection: Cloudflare Turnstile
- Storage: Cloudflare KV (SUBMISSIONS)
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
- Cloudflare KV provides best-effort submission controls.
- Campaign recommendations do not guarantee advertising results.

## CI/CD

GitHub Actions runs automated tests and validates the frontend build.
Cloudflare Pages hosts production. GitHub Pages is not used.
