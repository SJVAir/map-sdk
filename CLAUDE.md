# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Where this fits

map-sdk is part of the SJVAir Dashboard project. **Its plan and direction live in
data-dashboard's docs, not here** (`/home/alex/workspace/sjvair/data-dashboard`):

- `TODO.md` → "Start here" (which sessions run where) and "Release 1, step 5" (map-sdk's status
  and what's next).
- `ROADMAP.md` item 5, and `ARCHITECTURE.md` → "Map SDK".
- `DEFERRED.md` → "Map plugins" and "Map & selection" (milestone 2, deferred features).

Read those before starting new work. This repo holds each milestone's own spec and plan
(`docs/superpowers/specs/` and `plans/`); milestone 1 (both dated 2026-11-03) is built and merged
(#1). Milestone 2 (monitor-map parity) starts with the monitor-map 5.0 rebuild and gets its own
spec.

Rules that cross repos:

- Don't modify monitor-map, mobile, or the dashboard; read them freely. sjvair.com builds
  monitor-map `main` unpinned, and mobile depends on it.
- When map-sdk needs something `@sjvair/sdk` lacks, change the SDK, not a workaround here. If
  another session owns sdk-js, message it (ListAgents / SendMessage) instead of editing it.
- Record every deferral in data-dashboard's `DEFERRED.md`, with why and a revisit trigger, and
  keep map-sdk's status in `TODO.md` current. Edit data-dashboard docs only in your own
  worktree (`.worktrees/docs-<track>` from `origin/main`), never its main checkout. Docs-only
  commits go straight to its `main` (fetch and rebase first).

## Commands

```bash
npm run dev            # Demo page (demo/) on the Vite dev server; /api/ proxies to localhost:8000
npm run build          # svelte-package: src/lib -> dist/
npm run check          # svelte-check (also type-checks the README examples spec)
npm run lint           # Prettier check + ESLint
npm run format         # Auto-format with Prettier
npm test               # All Vitest projects (specs in tests/**)
npm run test:unit      # Server-compiled specs, node
npm run test:client    # Client-compiled specs (runes' $effects run), no DOM
npm run test:browser   # Component specs in real Chromium
npm run test:bundle    # build, then check the light entries stay off the map engine
npm run test:licenses  # build, then check bundled dependencies' licenses
npm run test:e2e       # Playwright against the demo (Chromium, Firefox, WebKit)
```

Run `npm run test:bundle` before committing any change under `src/lib`.

WebKit e2e runs in CI only: locally it needs system libraries installed with sudo, so run the
`chromium` and `firefox` projects (`npx playwright test --project chromium --project firefox`).
The e2e web server uses a placeholder MapTiler key, never `.env`.

## Architecture Overview

A Svelte 5 library (`@sjvair/map-sdk`, built with `svelte-package`) of map components for SJVAir
air-quality data on the MapTiler SDK. The demo page in `demo/` is the dev server's root and is
not shipped. Specs live in top-level `tests/`, never in `src/lib`.

- **Core** (`src/lib/core/`): `createMap()` returns a `MapContext` (`create-map.svelte.ts`):
  reactive camera, bounds, basemap, plugin list, selection per plugin, `featureclick`, `featuresAt`,
  `featureForElement`, camera moves (`easeTo`/`flyTo`/`fitBounds`), `ready`, `gl`,
  `projection`/`space` config, and the `maptilerMap()` escape hatch (for markers and popups only).
  It has no GL map of its own; `MapView` attaches one. `plugin.ts` defines `MapPlugin`
  (`hoverPriority`, `tooltipShowsName`, `hoverable`) and `PluginContext` (`addCustomLayer`);
  `scoped-context.ts`'s internal `scopedContext` lets a preset run a nested plugin under a prefix. `shape-view.ts` is the shape-aware
  in-view test (`intersectsBounds`, `geometryBbox`) and the in-view anchor (`shapeAnchor`); focusing
  a shape that overlaps the view with its label point off-screen keeps the camera and sets
  `focusedAnchor` (`anchorFor` gives the same point for hover).
  `plugin-host.svelte.ts` runs plugins' `setup` when the style is ready and tears them down on
  detach or restyle (draw order = registry order); `interactions.svelte.ts` routes clicks, hovers
  (and the pointer cursor), and blocking layers (cluster bubbles); a `hoverable: false` plugin's
  features are left out of the hover as if not drawn, but still clicked; `basemap.svelte.ts`
  switches and falls back between styles. Nothing is module-global: two maps on a page never share
  state, and every source/layer id is namespaced `${mapUid}:${pluginId}:${local}`.
- **Data** (`src/lib/data/`, entry `./data`): types (`DataSource`, `FeatureRef`,
  `SpatialSelection`, `FireFeatureProperties`), `Scale` helpers (`levelFor`, `NO_LEVEL`), refs,
  selection rules, `staticSource`, and the three providers (`metadata`, `messages`, `format`) with
  defaults (`format.dateTime` gives sjvair.com's "4:00 pm Friday Nov 06, 2026", in Pacific).
  `messages/en.json` holds every `mapsdk_*` UI string.
- **Stores** (`src/lib/stores/`, entry `./stores`): `createMonitorsStore()` (live monitors list and
  readings with polling, `meta`), `createHmsSmokeStore`, `createHmsFireStore`, and
  `createCollocationSitesStore`, the last three on the shared `load-once` core. Each exposes a
  `dataSource`. `cleanFires` is exported from here.
- **Plugins** (`src/lib/plugins/`): the general `pointsPlugin` (icons, clusters; `selectedStyle`,
  `icon.mutedColor`, `zoomRange`, `legendDisplay`, `legendTitle`, `detail` for features with no
  level, `truncateValues` to cut values off instead of rounding) and `shapesPlugin`
  (fill/`outline`/check overlay, `hoverable`), plus shared style expressions, scale resolution,
  and the exported marker shapes (`circle`, `square`, `triangle`, `withCrosshair`).
- **Presets** (`src/lib/presets/`): `monitorsPlugin`, `collocationSitesPlugin`, `regionsPlugin`,
  `calHeatScorePlugin`, `forecastZonesPlugin`, `hmsSmokePlugin`, `hmsFirePlugin` (groups, then
  hotspots from zoom 10), and `groupFires`, with the monitor, cluster (its "within a X mi² area"
  line from `cluster-area.ts`'s convex hull), collocation (`CollocationTooltip`), and fire
  (`FireTooltip`, the reading box) tooltips. Smoke takes no hover. Presets never fetch.
- **View** (`src/lib/view/`): `MapView.svelte` creates the GL map (`create-gl-map.ts`: per-map key
  through `transformRequest`, theme watching, `active` releases WebGL). Props include `controls`
  (`"mapsdk"` | `"engine"` | `"none"`), `selectionBar`, `tooltip` (`"pinned"` | `"pointer"`), and
  `featureList` (`boolean` or `{ position, reveal }`; `list-placement.ts`; the button stacks clear
  of the controls in its corner, measured with a `ResizeObserver`). Credits come from the engine's
  AttributionControl, with data credits from `ui/data-credits.svelte.ts`.
- **UI** (`src/lib/ui/`): Legend (`order`, `framed`; blocks legends are one labeled bar), FeatureList,
  MapTooltip, SelectionBar, ViewSummary, and MapControls (zoom buttons only; basemap switching is
  `MapContext`, credits are the engine's). `controls.css` holds the focus ring and motion classes.
  `feature-list.ts`'s `shownValue` is the one place a row's or tooltip's value text is made; it
  hides a category reading's code, since the level label already says it.
- **Entries**: `.` (everything, reaches the map engine), `./data` and `./stores` (must not reach
  maplibre or MapTiler; `test:bundle` enforces it), `./messages/en.json`, `./theme.css`.
  `theme.css` maps the family tokens to Tailwind utilities with fallbacks.

### Rules that bind new code

- Components use only theme tokens (shadcn names plus family tokens with fallbacks, listed in
  README.md). `--highlight` is never for text. Never assume a `.dark` class. Type sizes are
  Tailwind `text-*` classes, so hosts add the `@source` line. The user's fixed-color exceptions
  (decided 2026-11-04, never "fix" them back to tokens): inactive monitors `#969696`, the
  inside-monitor outline `#000000`, and the collocation crosshair `#4A5FC6`.
- No hardcoded labels, units, breakpoints, colors, or scales: they come from a `Scale` or the
  metadata provider. Every UI string is a `mapsdk_*` message key in `en.json`; no concatenated
  sentences. Dates and times are formatted in America/Los_Angeles through the `format` provider.
- Color never carries meaning alone: levels are shown with labels, swatches have an outline,
  selection is a `--highlight` ring plus a check mark. Respect `prefers-reduced-motion`.
- Bundled dependencies may only be MIT, BSD, Apache-2.0, ISC, MPL-2.0 (unmodified), or OFL-1.1
  (fonts). Never add `@maptiler/weather`. `@maptiler/sdk` is pinned `~4.2.0` because `GlMap`
  depends on its internals.
- Keep the README token list, examples, and `tests/unit/readme-examples.test.ts` in step with the
  public API.

### Test projects

`vitest.config.ts` defines three projects. `unit` (`tests/unit/**`) compiles Svelte in server mode
in node, so `$effect`s do not run. `client` (`tests/client/**`) uses `tests/client/environment.ts`
to compile for the client with no DOM, so rune modules' effects run. `browser` (`tests/browser/**`)
mounts components in headless Chromium. Fixtures are in `tests/fixtures/`. e2e (`e2e/`) runs the demo
with MapTiler requests routed to a local style.

### Local stack

The demo needs the sjvair.com stack on `localhost:8000` (Vite proxies `/api/`) and
`VITE_MAPTILER_KEY` in `.env` (copy `.env.example`; never print or commit it). A fresh database
needs `podman exec sjvaircom_web_1 python manage.py loaddata default-calibrations.yaml`.

## Code Style

- **Tabs** for indentation (not spaces)
- **Double quotes** for strings
- No trailing commas
- Print width: 100 characters
- Prettier + ESLint (flat config); run `npm run format` before committing
- Svelte 5 runes only; Tailwind CSS v4 utility classes in markup
- Never give a component and a `.svelte.ts` module the same base name in one folder
  (`Foo.svelte` + `foo.svelte.ts`); import rune modules with their full extension
  (`./foo.svelte.js`)

## Commits, pull requests, and docs

Never include Claude or AI attribution in anything produced in this repository: no
`Co-Authored-By: Claude ...` (or similar) trailers in commits, no AI attribution in pull request
descriptions, comments, issue text, documentation, or any other generated content. Write and
commit as if solely authored by the user.

## Releases and publishing — standing restriction

Publishing to npm happens via `.github/workflows/release.yml`, triggered by a GitHub Release being
published. It runs `ci.yml`'s checks (through `workflow_call`, so there is one copy of them) and
publishes only if they pass. `ci.yml` runs on pull requests and pushes to `main` only (not on
other branch or tag pushes), inside Playwright's Docker image, whose tag must match the installed
Playwright version (`tests/unit/ci-playwright-image.test.ts`). NEVER create a GitHub release, run `npm publish`, or otherwise trigger this workflow
without the user's explicit permission for that specific release — every single time. Approval for
one release does not carry forward to the next, even later in the same session or as the natural
next step of a task already in progress (e.g. bumping a dependency and then "finishing" by
releasing it). Always stop and ask first, and wait for an explicit yes. The same goes for pushing
and tagging.

The workflow publishes with npm trusted publishing (OIDC, `--provenance`, no token secret), like
monitor-map. npm only allows a trusted publisher on a package that already exists, so the first
publish (`0.1.0-beta.1`, 2026-11-05) was run by hand by the user; the trusted publisher for
`@sjvair/map-sdk` (repository `SJVAir/map-sdk`, workflow `release.yml`) is now configured, and
later releases go through the workflow. `prepack` builds `dist`, so a hand-run publish never ships
without it. The release tag must be the package version (`v0.1.0` or `0.1.0`), and a
prerelease version (one with `-`) publishes to the `next` dist-tag.
