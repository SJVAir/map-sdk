# @sjvair/map-sdk

Svelte 5 map components for SJVAir air-quality data, built on the MapTiler SDK. A map is a
`createMap()` context, shown with `<MapView>`, with data drawn by plugins (monitors, region fills,
CalHeatScore, forecast zones, HMS smoke and fire, or your own GeoJSON). It ships a legend, a
feature list, a selection bar, tooltips, and zoom controls, all themed from the host's tokens.

Supported browsers: Chrome/Edge 111+, Safari 16.4+, Firefox 128+. MIT licensed.

## Install

Once published:

```bash
npm install @sjvair/map-sdk
```

Peer dependencies: `svelte` (^5.57) and `@sjvair/sdk`, which is published to
JSR and installed through npm's JSR registry as an alias:

```json
{
	"dependencies": {
		"@sjvair/sdk": "npm:@jsr/sjvair__sdk@^5.0.0-beta.2"
	}
}
```

and in the host's `.npmrc`:

```ini
@jsr:registry=https://npm.jsr.io
```

Tailwind CSS v4 is required in the host. Its stylesheet must scan this package for classes and
import the theme (the path in `@source` is relative to the stylesheet; this one is in `src/`):

```css
@import "tailwindcss";
@source "../node_modules/@sjvair/map-sdk/dist";
@import "@sjvair/map-sdk/theme.css";
```

Without the `@source` line the components are unstyled: their type sizes and spacing are Tailwind
classes in the markup.

MapTiler needs a key: pass it as `config.maptilerKey`. The key is added to each map's own requests,
so two maps can use different keys. The MapTiler SDK also logs an "API key is not set" warning to
the console when the host has not set its global key (`config.apiKey` from `@maptiler/sdk`). That
is cosmetic and can be ignored, or silenced by setting the global key too.

## Theme tokens

Components use only the host's tokens and never assume a `.dark` class; dark mode follows
`prefers-color-scheme` and `[data-theme]`/`.dark` changes on `<html>` (the map re-reads its colors
when they change). A token the host does not define falls back as below. Define the shadcn names
at least; the family tokens are optional.

Standard (no fallback, must exist): `--background`, `--foreground`, `--card`, `--card-foreground`,
`--primary`, `--primary-foreground`, `--muted`, `--muted-foreground`, `--border`, `--ring`,
`--radius`. Read with a fallback: `--popover` (`--background`), `--popover-foreground`
(`--foreground`), `--accent` (`--muted`).

| Family token             | Fallback                     | Used for                                                     |
| ------------------------ | ---------------------------- | ------------------------------------------------------------ |
| `--highlight`            | `--primary`                  | Selection ring, active fills (never text)                    |
| `--highlight-subtle`     | `--muted`                    | Selected-item fill                                           |
| `--highlight-foreground` | `--primary-foreground`       | Text on the selected fill                                    |
| `--card-border`          | `--border`                   | Panel and control borders                                    |
| `--shadow-card`          | `none`                       | Panels and controls                                          |
| `--shadow-lifted`        | `--shadow-card`, then `none` | Raised panels                                                |
| `--radius-control`       | `--radius`                   | Buttons and inputs                                           |
| `--overlay`              | `--background`               | Credits and map overlays                                     |
| `--link`                 | `--primary`                  | Links (credits)                                              |
| `--ring-edge`            | `--background`               | Edge of the focus ring (2px `--ring` outline plus this edge) |
| `--swatch-outline-width` | `1px`                        | Legend swatch outline                                        |
| `--swatch-outline-color` | a mix of `--foreground`      | Legend swatch outline                                        |
| `--motion-duration-fast` | `120ms`                      | Control transitions (0 under reduced motion)                 |
| `--motion-ease-standard` | `ease`                       | Control transitions                                          |

`theme.css` exposes the family tokens as Tailwind utilities (`bg-highlight`, `border-card-border`,
`text-link`, `ring-ring-edge`, `shadow-card`, `rounded-control`, `shadow-lifted`).

## A map

```svelte
<script lang="ts">
	import { createMap, Legend, MapView, monitorsPlugin } from "@sjvair/map-sdk";
	import { createMonitorsStore } from "@sjvair/map-sdk/stores";
	import { onDestroy, onMount } from "svelte";

	const store = createMonitorsStore();
	const map = createMap({ config: { maptilerKey: import.meta.env.VITE_MAPTILER_KEY } });
	map.addPlugin(
		monitorsPlugin({ source: store.dataSource, layerLabel: "Monitors", selectable: true }),
		{ selectionMode: "multiple" }
	);

	onMount(() => void store.init("pm25"));
	onDestroy(() => {
		store.dispose();
		map.destroy();
	});
</script>

<MapView {map} class="h-[600px]">
	{#snippet overlays()}
		<Legend {map} />
	{/snippet}
</MapView>
```

`createMap(options)` returns the map's state and services (`MapContext`) with no GL map yet;
`MapView` creates the GL map when it mounts. `MapView` draws the tooltip, selection bar, view
summary, zoom buttons, and the List button with its feature list, and the engine draws the
credits. `featureList={false}` leaves out the List button and its panel, and `selectionBar={false}`
the selection bar. `controls` picks the zoom controls: `"mapsdk"` (default) draws map-sdk's zoom
buttons, `"engine"` the MapTiler SDK's default zoom/compass and locate-me controls (top right, as
monitor-map uses today), and `"none"` none; the credits show in every case. Anything else goes in the `overlays` snippet, where
`getMapContext()` returns the map. `config.basemaps` replaces the default MapTiler Streets v4
variants; `config.initialView` and `config.cooperativeGestures` set the camera and gesture handling.
`config.projection` (`"mercator"` by default, or `"globe"`) and `config.space` (`false` by default, or
`{ preset: "milkyway" }` for a space background behind the globe) are passed to MapTiler only when set.

Without `createMonitorsStore`, build a `DataSource` yourself (below).

### Hiding the map (the WebGL release)

Browsers cap WebGL contexts. `<MapView {map} active={false} />` releases the map's context, and
`active` back to `true` rebuilds it with the same camera, basemap, selection, and the latest data.
Use it for a map on a hidden tab.

### Plugins and draw order

Plugins draw in the order they were added, later on top. `addPlugin(plugin, { before: "id" })`
draws just below another plugin, and `map.movePlugin(id, { before? })` moves an added plugin and
its layers to the top, or just below the plugin `before` names. A plugin object belongs to one
map: create one per map (adding an object that is set up on another map throws). The
presets are `monitorsPlugin`, `regionsPlugin`, `calHeatScorePlugin`, `forecastZonesPlugin`,
`hmsSmokePlugin`, and `hmsFirePlugin`; `pointsPlugin` and `shapesPlugin` are the general ones they
are built on. Presets don't fetch: the host supplies a `DataSource`. `monitorsPlugin` is
selectable by default, like the shape presets.

## Data sources

A `DataSource` is `{ status, features, scale }`: a load status (`loading`, `ready`, `error` with
`retry()`, or `unavailable`), a GeoJSON `FeatureCollection` whose features carry
`{ refKey, name, value }` properties, and a scale. The scale is either a `ScaleRef`
(`{ dataset, entryType }`, resolved by the metadata provider and used for the legend, tooltips,
and level labels) or a full `Scale`. A value the scale doesn't cover (null, negative) draws neutral
and reads "No level"; a level with an empty color draws neutral with its own label. While a
source loads, fails, or is unavailable, the legend says so (a failure offers "Try again", which
calls `status.retry()`). Values are shown with the metadata's display precision.

`createMonitorsStore()` (from `@sjvair/map-sdk/stores`) loads the monitors list and latest readings
for an entry type, polls every two minutes, and exposes `dataSource`. `init()`, `update()`,
`entryTypeFor()`, `pauseAutoUpdate()`, `resumeAutoUpdate()`, and `dispose()` are its controls. A
dashboard that has its own date-range data builds a `DataSource` itself instead.

### Plain GeoJSON: `staticSource`

```ts
import { createMap, shapesPlugin } from "@sjvair/map-sdk";
import { staticSource } from "@sjvair/map-sdk/data";
import type { FeatureCollection, Polygon } from "geojson";

declare const zones: FeatureCollection<Polygon, { refKey: string; name: string; value: number }>;

const map = createMap({ config: { maptilerKey: "…" } });
map.addPlugin(
	shapesPlugin({
		id: "zones",
		source: staticSource(zones, { dataset: "air-quality", entryType: "pm25" }),
		layerLabel: "Zones",
		mode: "choropleth" // "plain" is neutral, with no legend
	})
);
```

Pass `null` as the scale for features with no values. A feature's `refKey` is `monitor:<id>`,
`region:<type>:<code>` (the region's `external_id`, never its sqid), or `feature:<id>` (shown but
not selectable). `encodeRef`/`decodeRef` convert between refs and keys.

### Writing a plugin

A plugin is an object with an `id` and a `setup(ctx)` that adds sources, layers, and images
through its `PluginContext` and returns a teardown. The host runs `setup` once the map's style is
ready and again after a basemap or theme change; everything added through `ctx` is removed on
teardown, and ids are namespaced per map. `features()` feeds the feature list, tooltip, and
summary; `legend()` the legend.

```ts
import type { FeatureListItem, MapPlugin, PluginContext } from "@sjvair/map-sdk";
import { decodeRef, NO_LEVEL } from "@sjvair/map-sdk/data";
import type { FeatureCollection, Point } from "geojson";

type Sites = FeatureCollection<Point, { refKey: string; name: string }>;

function sitesPlugin(sites: Sites): MapPlugin {
	return {
		id: "sites",
		label: "Sites",
		setup(ctx: PluginContext) {
			const source = ctx.addSource("sites", { type: "geojson", data: sites });
			const layer = ctx.addLayer("dots", { type: "circle", source, paint: { "circle-radius": 5 } });
			ctx.interactive([layer], (props) => {
				const ref = decodeRef(String(props.refKey));
				const name = String(props.name);
				return ref && { pluginId: "sites", ref, refKey: String(props.refKey), name };
			});
			return () => {};
		},
		features: (): FeatureListItem[] =>
			sites.features.flatMap(({ properties: { refKey, name }, geometry }) => {
				const ref = decodeRef(refKey);
				const [lng, lat] = geometry.coordinates;
				if (!ref) return [];
				const lngLat: [number, number] = [lng, lat];
				return [
					{ refKey, ref, name, value: null, level: NO_LEVEL, units: "", lngLat, selectable: false }
				];
			})
	};
}
```

The root entry exports the types a plugin needs (`MapPlugin`, `PluginContext`, `FeatureHit`,
`FeatureListItem`, `LegendData`, `Providers`, `GlMapLike`, `LayerSpecWithoutId`, `ThemeColors`,
`ClusterLayers`, `ClusterLayerArgs`, `BlockingClick`, `Hovered`) and the scale expressions the
built-in plugins use (`colorExpression`, `opacityExpression`, `levelKeyExpression`).

## Selection

Each plugin has a mode: `none`, `single`, or `multiple` (set it with `addPlugin`'s
`selectionMode` or `map.setSelectionMode(id, mode)`). Click or tap picks; Shift/Cmd/Ctrl-click adds
or removes in `multiple`, and a tap does the same on touch. The selection is a `SpatialSelection`,
`{ kind: "monitors" | "regions", ids: string[] }` (region ids are `<type>:<code>`), and the host
owns it:

```ts
map.setSelection("monitors", { kind: "monitors", ids: ["abc123"] }); // host -> map
map.addPlugin(plugin, {
	selectionMode: "multiple",
	selection: { kind: "monitors", ids: ["abc123"] },
	onselectionchange: (selection) => save(selection) // map -> host (user picks only)
});
```

`setSelection` does not call `onselectionchange`. Ids that match no feature are kept and counted
in the selection bar, and a feature that appears later shows as selected. `map.getSelection(id)`
and `getSelectionMode(id)` are reactive.

`map.on("featureclick", ({ pluginId, ref, lngLat }) => …)` fires for every click on a feature,
whatever the mode, and also for a pick in the feature list, so keyboard users get the same event;
`lngLat` is the click point (the item's position for a list pick). It returns an unsubscribe
function. For your own context menu, `map.featuresAt({ x, y })` returns the hits under
a canvas point, topmost first, and `map.featureForElement(element)` returns the hit for a row of
the feature list (an element with `data-mapsdk-ref`). Both return nothing while the map is
detached.

## Camera

`map.easeTo({ center, zoom?, minZoom? })` and `map.flyTo(...)` move the camera; `minZoom` means "zoom
in to at least this" (`max(current zoom, minZoom)`), and `zoom` wins when both are given.
`map.fitBounds({ west, south, east, north }, { padding?, maxZoom? })` fits a box. All three do
nothing while the map is detached or destroyed, and use no animation under `prefers-reduced-motion`.

```ts
map.flyTo({ center: [-119.7, 36.7], zoom: 16 });
map.easeTo({ center: monitor.lngLat, minZoom: 12 });
```

## Ready, and reaching the GL map

`map.ready` is reactive: true once the attached map's style has loaded and the map has gone idle
for the first time, false again on detach and while a basemap switch reloads the style. Show a load
screen until it is true. `map.gl` is the attached GL map (or `null`), reactive.

`maptilerMap(map)` returns it as a MapTiler `Map` (or `null` while detached). It is an escape hatch
for markers and popups only: never add sources or layers through it, because plugins own those.

```ts
import { maptilerMap } from "@sjvair/map-sdk";

const gl = maptilerMap(map);
if (gl) new Marker().setLngLat(lngLat).addTo(gl);
```

## Providers

`createMap` takes three optional providers, so a host controls where its labels and metadata come
from:

- `metadata`: scales, entry-type labels and units, monitor type labels, and dataset attribution.
  The default reads the SJVAir API through `@sjvair/sdk`.
- `messages`: `(key, params) => string`. The default is the English catalog,
  `@sjvair/map-sdk/messages/en.json`, with `{name}`-style parameters and `_one`/`_other` plurals
  selected by `count`.
- `format`: numbers, date-times in America/Los_Angeles, a "PT" zone label when the device is
  elsewhere, and `relativeTime(date, now?)` ("5 minutes ago").

Every UI string is a `mapsdk_*` key. To translate them in a Paraglide project, add
`node_modules/@sjvair/map-sdk/dist/data/messages/en.json` (exported as
`@sjvair/map-sdk/messages/en.json`) to the project's message sources, translate the keys, and
adapt the generated functions:

```ts
import * as m from "$lib/paraglide/messages.js";
import type { MessageKey, MessageParams } from "@sjvair/map-sdk/data";

const messages = (key: MessageKey, params?: MessageParams) =>
	(m as unknown as Record<string, (p?: MessageParams) => string>)[key]?.(params) ?? key;

const map = createMap({ config: { maptilerKey: "…" }, messages });
```

A key that is a plural base (for example `mapsdk_selected_count`) arrives with `params.count`;
the catalog stores it as `<key>_one` and `<key>_other`, so a provider over a different catalog
maps it to its own plural form. Layer names (`layerLabel`) are passed already translated.

## Examples are checked

`tests/unit/readme-examples.test.ts` repeats the TypeScript examples above (the map setup, plain
GeoJSON, writing a plugin, selection, and a message provider) against the real exports: `npm run
check` type-checks them and `npm test` runs them. The Svelte markup isn't mounted there. Update
it with the README.

## Demo and the local stack

`npm run dev` serves the demo page (`demo/`): two maps on one page, one fed from date-range
sources like the dashboard and one from the live monitors store, with the presets, selection
modes, and theme toggles. It calls the API on its own origin, and Vite proxies `/api/` to the
local sjvair.com stack at `http://localhost:8000`.

1. Copy `.env.example` to `.env` and set `VITE_MAPTILER_KEY`. Never commit `.env`.
2. Start the sjvair.com stack on port 8000.
3. A fresh database has no calibrations; load them once:

   ```bash
   podman exec sjvaircom_web_1 python manage.py loaddata default-calibrations.yaml
   ```

## Development

```bash
npm run lint           # Prettier check + ESLint
npm run check          # svelte-check
npm test               # unit, client, and browser (Vitest) projects
npm run test:bundle    # build, then check the light entries stay off the map engine
npm run test:licenses  # build, then check bundled dependencies' licenses
npm run test:e2e       # Playwright on the demo (Chromium, Firefox, WebKit)
npm run build          # svelte-package into dist/
```

See `CLAUDE.md` for the architecture.
