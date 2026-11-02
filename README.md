# Meta Ads Planner

Static client-side Meta Ads planning form for customer-service representatives. No backend, cookies, analytics, account login, or customer-data storage. Form values are only in memory until tab closes. Reports can be downloaded as HTML or printed to PDF.

## Test locally

```bash
npm test
python3 -m http.server 8000
```

Open http://localhost:8000 (do not open index.html via file:// because JavaScript modules may be blocked).

## Deploy on GitHub Pages

1. Create a **new public** GitHub repository, e.g. `meta-ads-planner`. Never upload real customer records.
2. Upload the contents of this directory (including `.github/workflows/ci.yml`) to its `main` branch.
3. In repository **Settings → Pages**, set **Build and deployment → Source → GitHub Actions**.
4. Open **Actions**, run **Test and deploy Pages** if not already running. Confirm tests and deploy are green.
5. Find the published URL in **Settings → Pages** (typically `https://USERNAME.github.io/meta-ads-planner/`). Share it with your representative.
6. Test on a phone and desktop. Submit a dummy customer, confirm totals, export HTML and print PDF. Check the preview and Meta settings manually before any real campaign.

## Important

GitHub Pages is publicly accessible: it does not provide employee authentication. Do not enter passwords, card data, private phone numbers or other sensitive customer information. Generated reports contain the data entered; share and store them securely. This is rule-based guidance, not live Meta API validation or guaranteed performance. Meta may change objectives, targeting options, policies, or placement names.
