// Declarative manifest for the screenshot-capture tool (scripts/capture-shots.mjs).
//
// Each project is one recipe, in one of two modes:
//   url  — a public, deployed web app: drive its URL, screenshot, crop, drop into the blog's public/.
//   raw  — an auth/seed-heavy app whose OWN Playwright spec (living in that app's repo, reusing its
//          E2E fixtures) produced full-page PNGs; we only crop + place them.
//
// Add a new app = add an entry here. Outputs land at apps/blog/public/<project>-<shot.name>.png.
// Crop is from the top-left; { height } keeps the top N px (full width), { width } narrows it.

export default {
  // Public deployed dashboard — no auth, no seeding. Point at prod (pg_kafka runs only land there;
  // beta's Neon branch has none) and shoot. Override with SHOTS_BASE_URL / --base-url.
  tracer: {
    mode: 'url',
    baseUrl: 'https://tracer.rtrentjones.dev',
    viewport: { width: 1440, height: 900 },
    shots: [
      {
        // The pass-rate-over-time line chart + latest-run table on the home dashboard.
        name: 'trend',
        path: '/',
        waitFor: 'text=Pass rate over time',
        settle: 1500, // Recharts enter animation
        crop: { height: 845 }, // header → chart → "Latest run per tool" card (drop the dangling next header)
      },
      {
        // The pg_kafka benchmark history as a filterable table.
        name: 'runs',
        path: '/runs?tool=pg_kafka',
        waitFor: 'table',
        crop: { height: 880 }, // header → filter bar → full runs table
      },
    ],
  },

  // Auth + seed-heavy app. Its own committed spec (tools/heistmind/e2e/specs/capture-shots.spec.ts)
  // drives the product with an injected GM session and writes full-page PNGs to e2e/.shots/; we crop.
  // See that spec's header for how to (re)generate the source PNGs.
  heistmind: {
    mode: 'raw',
    source: 'tools/heistmind/e2e/.shots',
    shots: [
      { from: '03-wizard-attributes.png', name: 'wizard', crop: { height: 860 } },
      { from: '04-character-sheet.png', name: 'character', crop: { height: 1560 } },
      { from: '01-campaign.png', name: 'campaign', crop: { height: 1290 } },
    ],
  },
};
