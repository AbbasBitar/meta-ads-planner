# Meta Ads Planner Telegram delivery v2

## Before enabling real customer data

This public GitHub Pages form has no user authentication. Use dummy data for initial testing. Turnstile is an anti-bot challenge, **not** an authorization control. Cloudflare KV rate limiting is best-effort, not atomic. For production, add Cloudflare WAF rate limiting, restrict representative access with an identity provider, and assess customer privacy and consent.

## Step A — Cloudflare Turnstile

1. Cloudflare Dashboard → Turnstile → Add widget.
2. Widget hostname: `abbasbitar.github.io`; choose Managed mode.
3. Copy **site key** into `config.js` in the GitHub Pages repo.
4. Store **secret key** in Worker Settings → Variables and Secrets as `TURNSTILE_SECRET` (type Secret). Never commit it.

## Step B — Cloudflare KV

1. Cloudflare Dashboard → Storage & databases → KV → Create namespace named `meta-ads-planner-submissions`.
2. Bind it to the Worker under Settings → Bindings with variable name `SUBMISSIONS`.
3. For Wrangler deployments, replace `REPLACE_WITH_KV_NAMESPACE_ID` in `worker/wrangler.toml` with the namespace ID. For dashboard deployments, bind it in the dashboard and paste `worker/index.js` and `worker/planner.js` using the multi-file editor.

## Step C — Deploy Worker

The Worker imports `./planner.js`. Both files must be present. Use Wrangler from the `worker/` directory (Node 22 recommended):

```bash
npm install -g wrangler
cd worker
# Edit wrangler.toml KV namespace ID first
wrangler login
wrangler deploy
```

Worker name matches the existing `meta-ads-planner-apicopy`. The existing `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` secrets remain on the Worker. Verify `/health` returns `status: ok`.

## Step D — Deploy GitHub Pages

Copy `index.html`, `app.js`, `config.js`, `styles.css`, `src/planner.js`, and `tests/` to the GitHub repository. Run `npm test`. Push to `main`; GitHub Pages deploys via existing Actions workflow.

## Step E — Smoke test

1. Load the public site; check Turnstile loads.
2. Submit dummy customer and confirm Telegram receives `MAP-...txt` attachment.
3. Verify the representative sees **only** the reference and success message.
4. Verify invalid age/budget and incomplete Turnstile do not submit.
5. Confirm the report is **not** rendered in the browser or saved in the repository.

## Limitations

The Worker verifies Turnstile, origin and input schema, and uses KV for best-effort rate and duplicate control. `Origin`/CORS alone are not authentication. KV is eventually consistent; strong exactly-once delivery would require a Durable Object/queue. A timeout can make Telegram delivery uncertain, so confirm with the owner before retrying. Customer submissions are sent to Telegram; Telegram's data retention and privacy policies apply. Cloudflare processes submissions transiently; KV stores only hashed-IP-derived rate keys and submission IDs/references, not the full customer report. IP addresses are hashed with a server-side secret before being used as KV keys.
