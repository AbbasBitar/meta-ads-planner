# Meta Ads Planner

A simple campaign brief builder. The page validates campaign details, calculates a daily budget, and generates a structured prompt for the user to copy into ChatGPT.

The Campaign Tracker stores planned boosts in this browser's local storage. The simplified boost editor asks for page name, boost creation date/time, planned start date/time, automatically calculated end date/time, budget, an optional target cost per result, boost purpose, and desired ad action (Visit your profile, Visit your website, Message you, or Mix of actions). Each boost card offers **Log results** to record the daily spend and results reported by Meta; logging the same date again replaces that entry. A **Daily check** section ranks active boosts by urgency — comparing actual cost per result with the target and spend pacing with the plan — and suggests whether to keep, watch, or pause each boost. The **+ Add campaign** action opens the editor without a campaign brief. Saving from **Track Campaign** reuses an existing page by its handle or URL and an existing campaign with the same purpose, so repeated saves do not duplicate records. Creation dates are user-entered and do not prove Meta delivery; historical boosts without a recorded creation date remain intact and require the date when next edited. The existing client/page/campaign relationships are retained internally, supporting multiple boosts and JSON backup/restore without losing older data. Dates are stored as ISO 8601 UTC timestamps; durations are elapsed 24-hour periods. Scheduled, Active, and Completed labels describe the saved plan only.

Imported backups are validated and previewed before anything is written. Choose **Merge into current data** to keep existing records and add new ones, **Replace all data** to discard the current tracker first, or **Cancel** to leave everything unchanged. After a merge or replace, **Undo import** restores the previous tracker data until the next tracker change.

## Appearance

The header has a **Dark mode / Light mode** toggle. Without a saved selection, the interface follows the device's light/dark appearance setting. An explicit selection is saved in browser local storage and reused on subsequent visits; switching the appearance does not modify tracker or campaign records. The client report automatically uses a light print layout for legibility.

## How it works

1. Enter business, page, product, audience, post, budget, duration, and ordering details.
2. Select **Generate ChatGPT Prompt** and review the complete prompt.
3. Copy the prompt, open ChatGPT, then paste and submit it yourself.

Campaign details stay in the browser. The app does not call an AI API, submit data to `/api/submit`, or put campaign information in a URL. The ChatGPT link opens `https://chatgpt.com/` in a separate tab; the app cannot insert a prompt into a ChatGPT conversation. No AI API keys are needed.

## Development

Requirements: Node.js 22 or later and npm.

Run automated tests:

    npm test

Build the static frontend:

    npm run build

Build output: `dist/`.

## Deployment notes

The app is a static frontend with no server-side components. The repository retains its GitHub Actions validation workflow. See `DEPLOY.md` for hosting instructions and the legacy Cloudflare decommissioning checklist.

## Campaign guidance

ChatGPT recommendations are suggestions and do not guarantee advertising results. Meta targeting options can change; confirm interests and settings in Ads Manager before publishing. A post URL is passed as text in the prompt, but ChatGPT must not claim to have inspected the post unless it actually retrieves and reviews its contents.
