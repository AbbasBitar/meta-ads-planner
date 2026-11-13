# Meta Ads Planner

A simple campaign brief builder. The page validates campaign details, calculates a daily budget, and generates a structured prompt for the user to copy into ChatGPT.

The Campaign Tracker stores planned boosts in this browser's local storage. The simplified boost editor asks for page name, boost creation date/time, planned start date/time, automatically calculated end date/time, budget, duration, boost purpose, and desired ad action (Visit your profile, Visit your website, Message you, or Mix of actions). Creation dates are user-entered and do not prove Meta delivery; historical boosts without a recorded creation date remain intact and require the date when next edited. The existing client/page/campaign relationships are retained internally, supporting multiple boosts and JSON backup/restore without losing older data. Dates are stored as ISO 8601 UTC timestamps; durations are elapsed 24-hour periods. Scheduled, Active, and Completed labels describe the saved plan only.

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

The repository currently retains its GitHub Actions validation workflow. Production hosting and infrastructure were not changed as part of the local v2 implementation. Review `DEPLOY.md` before a future production migration.

## Campaign guidance

ChatGPT recommendations are suggestions and do not guarantee advertising results. Meta targeting options can change; confirm interests and settings in Ads Manager before publishing. A post URL is passed as text in the prompt, but ChatGPT must not claim to have inspected the post unless it actually retrieves and reviews its contents.
