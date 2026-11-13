# @sjvair/map-sdk

Svelte 5 map components for SJVAir air-quality data, built on the MapTiler SDK. A map is a
`createMap()` context, shown with `<MapView>`, with data drawn by plugins (monitors, region fills,
CalHeatScore, forecast zones, HMS smoke and fire, or your own GeoJSON). It ships a legend, a
feature list, a selection bar, tooltips, and zoom controls, all themed from the host's tokens.

Supported browsers: Chrome/Edge 111+, Safari 16.4+, Firefox 128+. MIT licensed.

## Install

map-sdk is in beta. Betas are published under the `next` tag:

```bash
npm install @sjvair/map-sdk@next
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

and in the host's `.npmrc` (npm 12 refuses the JSR registry's tarball URLs unless
`allow-remote` lets the root project fetch them):

```ini
@jsr:registry=https://npm.jsr.io
allow-remote=root
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
| `--focus-area`           | `#1f2d3d` (fixed)            | The focus area's line, point ring, and label                 |
| `--focus-area-casing`    | `#ffffff` (fixed)            | The casing under them, and the label's halo                  |
| `--focus-area-wash`      | `#ffffff` (fixed)            | The wash outside a focus area                                |
| `--school-marker`        | `#5a6b7b` (fixed)            | School badges and count bubbles                              |
| `--child-care-marker`    | `#15747c` (fixed)            | Child care badges and count bubbles                          |

The focus area's and the school markers' tokens fall back to fixed colors, not to theme tokens:
they're drawn on a basemap, which doesn't follow the page's theme. Set them only to override the
defaults.

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
the selection bar. `featureList` also takes options (type `FeatureListOptions`): `position` puts the
button in any corner (`"top-left"`, the default, `"top-right"`, `"bottom-left"`, `"bottom-right"`),
stacked below the controls in that corner (above them in a bottom corner), and the open panel
stops short of the controls and credits at the far end of its side. `reveal: "focus"` shows the
button only while it or its open panel has keyboard focus, and the whole time the panel is open;
otherwise it's visually hidden but stays in the Tab order and the accessibility tree, like a skip
link. monitor-map uses `featureList={{ position: "top-right", reveal: "focus" }}` with
`controls="engine"`. The List button and its open panel are `z-index: 2` inside the map, so a
host's own menus over the map can sit above them. `controls` picks the zoom controls: `"mapsdk"` (default) draws map-sdk's zoom
buttons, `"engine"` the MapTiler SDK's default zoom/compass and locate-me controls (top right, as
monitor-map uses today), and `"none"` none; the credits show in every case. Choose `controls` up
front: changing it after mount recreates the map. `tooltip` is `"pinned"` (default: anchored to the
feature) or `"pointer"` (shown at the pointer, as sjvair.com's map does, and hidden on zoom until
the pointer moves again); a feature focused from the list is always pinned. `card` (default
`false`) pins the reading card on a click or tap: the card takes the pointer, has a Close button,
and closes with Esc, Close, or a click elsewhere on the map; focusing a feature-list row shows the
same card, and Tab from the row reaches it. Esc closes the card of the map that has focus; with
focus nowhere, it closes the page's most recently pinned card. One card shows at a time, and no hover card shows while
one is pinned. Selection and `featureclick` are unchanged: a click still selects as before and
also pins. `map.pinned` is the pinned feature (reactive), and `map.unpin()` closes it.
`card={{ actions }}` also puts your buttons in a row at the card's foot: `actions` is a snippet
given a `CardContext` (`pluginId`, `ref`, `refKey`, the listed `item` or `null`, reactive
`selectable` and `selected`, and `toggle()`, which is `map.togglePick` for that feature). Show
Select/Remove only when `selectable` is true: a fire hotspot, a smoke plume, or a layer in mode
`"none"` can't be selected, and `toggle()` then does nothing. Anything else goes in
the `overlays` snippet, where `getMapContext()` returns the map. `config.basemaps` replaces the
default MapTiler basemaps (build on `defaultBasemaps()`, which `createMap` uses: today's
sjvair.com setup is `defaultBasemaps({ keepPoiLabels: true })`); `config.initialView` and
`config.cooperativeGestures` set the camera and gesture handling. `config.projection` (`"mercator"`
by default, or `"globe"`) and `config.space` (`false` by default, or `{ preset: "milkyway" }` for a
space background behind the globe) are passed to MapTiler only when set. `config.telemetry: false`
turns off MapTiler's telemetry (a usage report of the SDK version, API key, and session id, sent
about 2 s after each map is created) before the map is created. It is a page-wide setting in
MapTiler's SDK: once one map turns it off, it stays off for every map on the page. MapTiler's
session id (`mtsid`) stays on either way, since MapTiler bills SDK maps by session (without one,
every tile request counts on its own) and its tile cache needs it. By default (`true`) MapTiler's
own default applies.

Without `createMonitorsStore`, build a `DataSource` yourself (below).

### Hiding the map (the WebGL release)

Browsers cap WebGL contexts. `<MapView {map} active={false} />` releases the map's context, and
`active` back to `true` rebuilds it with the same camera, basemap, selection, and the latest data.
Use it for a map on a hidden tab.

### Plugins and draw order

Plugins draw in the order they were added, later on top. `addPlugin(plugin, { before: "id" })` draws
just below another plugin, and `map.movePlugin(id, { before? })` moves an added plugin and its
layers to the top, or just below the plugin `before` names. A plugin object belongs to one map:
create one per map (adding an object that is set up on another map throws). The presets are
`monitorsPlugin`, `regionsPlugin`, `calHeatScorePlugin`, `forecastZonesPlugin`, `hmsSmokePlugin`,
`hmsFirePlugin`, `collocationSitesPlugin`, and `focusAreaPlugin`; `pointsPlugin` and `shapesPlugin` are the general
ones they are built on. Presets don't fetch: the host supplies a `DataSource`. `monitorsPlugin` is
selectable by default, like the shape presets.

An added plugin is in `map.plugins` (and the legend and selection state) as soon as `addPlugin`
returns. On a map that is already showing, its `setup` runs just after the current code finishes,
so its layers aren't there yet on the next line. Code that must see them uses `await tick()`;
`flushSync()` does not run setup.

Selected points show a highlight ring and check mark by default. `selectedStyle: "enlarge"` on
`pointsPlugin` or `monitorsPlugin` instead draws the selected icon at 1.3x with no ring (icon
points only), as sjvair.com's map does today.

`outline` on `shapesPlugin` is `"theme"` (default, a 1px `--foreground` edge), `"level"` (the edge
in each level's color at the fill's opacity; choropleth only), or `"none"` (no outline layer).
`hmsSmokePlugin` uses `"level"`. `hoverable: false` on `shapesPlugin` sets the plugin's
`hoverable` (see [Writing a plugin](#writing-a-plugin)): hovering a shape shows no tooltip and
doesn't hide what is beneath it, while focusing it from the feature list still pins its tooltip.
`hmsSmokePlugin` uses it, so a plume, which can cover much of the map, never pops up a tooltip.

```ts
map.addPlugin(
	shapesPlugin({
		id: "plumes",
		source: staticSource(plumes, { dataset: "hms-smoke", entryType: "smoke-density" }),
		layerLabel: "Plumes",
		mode: "choropleth",
		hoverable: false
	})
);
```

`zoomRange: { min?, max? }` on `pointsPlugin` limits every layer it draws (points, clusters,
selection) to camera zooms from `min` (inclusive) up to `max` (exclusive), switching live while
zooming. Two plugins whose ranges meet hand over with no gap, on the globe too.

`hmsFirePlugin({ id?, source, hotspots?, layerLabel })` draws fires as flame icons sized and
colored by FRP. With `hotspots`, it switches by itself while zooming, as sjvair.com's map does:
`source` (the fire store's `groups`) below zoom 10 and `hotspots` from zoom 10. It stays one
layer: one legend section, one feature list (the groups, so keyboard users reach every fire;
hotspots aren't listed), and tooltips for both. The tooltip is the monitors' reading box: "Fire
(MW)", the power in its level's color, beside the name ("3 fire detections", "1 fire detection"
for a group, "Fire detection" for one detection) and the level ("50–149 MW"); a group of two or
more says "Average". A feature with a `count` (`FireFeatureProperties`, which the fire store's
groups carry) is a group. Fire values are cut off at the display precision, not rounded, in the
tooltip, the list and its accessible names, so 9.96 MW reads "9.9" beside "<10".

`legendDisplay: "gradient" | "blocks"` on `pointsPlugin` sets how the legend draws a range scale
(default a gradient; `hmsFirePlugin` uses `"blocks"`, labeled with the levels' own labels). A blocks
legend (also every category scale, such as smoke) is one outlined bar of contiguous segments with
each level's label under its segment; long labels wrap. `legendTitle: "layer" | "entry-type"` sets
the legend section's title: `layerLabel` (default) or the entry type's label from the metadata
provider (`monitorsPlugin` uses the latter, so its section reads "PM2.5"; `layerLabel` still names
the layer in the list, selection bar and summary). `Legend` takes `order` (`"bottom-first"`,
default, or `"top-first"`) and `framed` (`true`, default, draws its own card; `false` draws no
border, background, padding or fixed width, so a host's own card frames it). The framed legend
and the feature list panel are 21rem wide at most, and never wider than the map less 2rem (the
window less 2rem outside a `MapView`), so they fit a small map on a wide screen. Without a frame,
translucent swatches blend over the nearest ancestor with an opaque background (a see-through
card is skipped), else `--background`; that color is read on mount, when `framed` changes, and on
a theme change, but not when the card changes color through its own class or style.

```svelte
<div class="w-84 rounded-md bg-white shadow">
	<h3>Legend</h3>
	<Legend {map} framed={false} />
</div>
```

`detail?(props)` on `pointsPlugin` gives a feature with no level a short text (such as "Level 2
charger") shown where "No level" would be: in the feature list (plain text, no swatch), the row's
accessible name ("Fresno Station, Level 2 charger"), and the tooltip. A feature with a level
always shows its level. A plugin of your own sets the same `detail` on its `FeatureListItem`s.

`truncateValues: true` on `pointsPlugin` cuts values off at the display precision instead of
rounding them (`truncate` on each `FeatureListItem`), in the list, its accessible names, and the
generic tooltip, so a value never reads as the next level up. `hmsFirePlugin` uses it.

`collocationSitesPlugin({ id?, source, layerLabel })` draws collocation sites as sjvair.com does:
each at its reference monitor, in that monitor's shape and level color (inactive gray, inside
outlined), wrapped in a crosshair of `COLLOCATION_CROSSHAIR_COLOR` (`#4A5FC6`, a fixed color on
every theme). Its tooltip shows the reference and collocated monitors' readings side by side, each
with its time and level. It isn't selectable and adds no legend section (the monitors' scale is
shown by `monitorsPlugin`). Add it before `monitorsPlugin` so it draws under the monitors; its
`hoverPriority` is `Number.MAX_SAFE_INTEGER`, so its tooltip still wins over a monitor drawn above
it (clicks go to the topmost feature).

The monitor marker shapes are exported for your own plugins: `circle`, `square`, and
`triangle(color, borderWidth, borderColor?)` return a 24px SVG, and `withCrosshair(svg, color)`
wraps one in the crosshair (`CROSSHAIR_ICON_SIZE`, 56px, square). Pass the size to
`pointsPlugin`'s `icon.size`.

### The focus area

`focusAreaPlugin({ id?, layerLabel, geometry?, label? })` marks the place a map is about. Add it
first (or `before` the first data plugin), so the data draws over it.

- **An area** (`Polygon` or `MultiPolygon`) gets a two-tone outline (a slate line over a white
  casing) and a white wash over everything outside it. It isn't listed, clicked, or hovered.
- **A place** (`Point`) gets a two-tone ring with `label` beside it. It is one feature-list row
  named by the label (`layerLabel` without one), and clicking the ring (or focusing the row) pins a
  card with the label alone. It's never selectable, and a feature drawn above it (a monitor at the
  same spot) takes the click. The label is drawn on the map's canvas, so screen readers hear the
  row instead. A map with `featureList={false}` should name the place in `MapView`'s `label`.
- **`plugin.set({ geometry, label })`** changes the focus in place; `geometry: null` clears it.
  `plugin.focus` is the current one. Any other geometry type throws, from `set` or the options.
  The focus is kept across `active` off and on, basemap switches, and theme changes.

```ts
const focus = focusAreaPlugin({ layerLabel: "Places" });
map.addPlugin(focus, { before: "monitors" });
focus.set({ geometry: { type: "Point", coordinates: [-119.79, 36.74] }, label: "Your location" });
```

A list item's `noReading: true` (set on the focus point's) shows the item by its name alone: no
value, level, or "No level" in its row, its accessible name, or its card.

### Schools and child care

`schoolsPlugin({ id?, source, layerLabel, types?, zoomRange? })` draws public schools, private
schools, and child care sites as school-house badges: a school glyph in `--school-marker` for both
kinds of school, a baby glyph in `--child-care-marker` for child care. Zoomed out, each kind
gathers into school-house count bubbles; clicking one zooms in. It's never selectable.

- **`source`** is `{ status, features }`, with `features` exactly what `@sjvair/sdk`'s
  `getPesticideLocations` returns, passed through unchanged (a `SchoolsSource`). The preset never
  fetches: the host picks the area (a `bbox`, or a `region`), never a person's own location.
  A plain `{ status: { state: "ready" }, features }` works, as does any `DataSource` holding these
  features. Each feature's properties (`SchoolLocationProperties`, from `./data`):

  | Property                                                              | Used for                                          |
  | --------------------------------------------------------------------- | ------------------------------------------------- |
  | `id`                                                                  | Its ref, `{ kind: "feature", id }`                |
  | `name`                                                                | The list row and card                             |
  | `type`                                                                | `public_school`, `private_school`, `child_care`   |
  | `type_label`                                                          | The type's label until the metadata has one       |
  | `address`, `city`                                                     | The card                                          |
  | `school_district`, `grade_span`                                       | The card                                          |
  | `source`, `external_id`                                               | Not shown: `featureclick`'s `properties` has them |
  | `school_district_id`, `school_district_url`, `enrollment`, `capacity` | Not shown                                         |

  A null, missing, or blank value leaves its card line out.

- **`types`** is the types to draw (an allow-list); all three by default.
- **`zoomRange`**: every zoom by default.
- **Labels:** each type's label comes from the metadata provider's optional
  `locationTypeLabel(type, signal?)` (the default reads `getRegionsMeta`'s `location_types`), then
  the feature's `type_label`, then "Location". The legend has a "School" row (both kinds of
  school share a badge) and a "Child care" row; with a filter that keeps one school type, that
  row has its label.
- **Clicks:** `featureclick` carries the site's own `properties`, so a host can resolve it as a
  place with `getLocationsByCode(source, [external_id])`. Card buttons work as on any card.
- **On the focus point:** when the focus point sits at exactly a site's coordinates (take them
  from the feature itself), the site's badge stays inside the focus ring and takes the click, and
  the focus point's own list row is left out while the badge is drawn, so the place is listed
  once. Inside a count bubble, it isn't drawn on its own, so the row is back until it splits.

```ts
const schools = schoolsPlugin({
	source: { status: { state: "ready" }, features: await getPesticideLocations({ region }) },
	layerLabel: "Schools and child care",
	types: ["public_school", "private_school"]
});
map.addPlugin(schools, { before: "monitors" });
map.on("featureclick", (e) => {
	if (e.pluginId === "schools") console.log(e.properties?.external_id);
});
```

The badges' glyphs are Lucide's `school` and `baby` icons (lucide.dev, ISC license).

## Data sources

A `DataSource` is `{ status, features, scale }`: a load status (`loading`, `ready`, `error` with
`retry()`, or `unavailable`), a GeoJSON `FeatureCollection` whose features carry
`{ refKey, name, value }` properties, and a scale. The scale is either a `ScaleRef`
(`{ dataset, entryType }`, resolved by the metadata provider and used for the legend, tooltips,
and level labels) or a full `Scale`. A value the scale doesn't cover (null, negative) draws neutral
and reads "No level"; a level with an empty color draws neutral with its own label. While a
source loads, fails, or is unavailable, the legend says so (a failure offers "Try again", which
calls `status.retry()`). Values are shown with the metadata's display precision, except in the
monitor, cluster, and collocation tooltips, which match monitor-map: the reading and a cluster's
average are whole numbers, and a cluster's max and min are as reported. Fire values are cut off
rather than rounded (see `truncateValues`). On a category scale, a value that is its level's code
(smoke's `"light"`, the heat score's `2`) isn't shown: the list row, the tooltip, and the row's
accessible name give only the level label. Times in the tooltips read like sjvair.com's map, in
Pacific time: "4:00 pm Friday Nov 06, 2026", with " PT" after them on a device in another zone.
The monitor cluster tooltip's count line gives the area the monitors are within, "3 monitors
within a 22.619 mi² area": the area of their convex hull, left out when it would read 0.000 (two
monitors, or all on one line or one spot).

`createMonitorsStore()` (from `@sjvair/map-sdk/stores`) loads the monitors list and latest readings
for an entry type, polls every two minutes, and exposes `dataSource`. `init()`, `update()`,
`entryTypeFor()`, `pauseAutoUpdate()`, `resumeAutoUpdate()`, and `dispose()` are its controls. A
dashboard that has its own date-range data builds a `DataSource` itself instead.
`meta` is the read-only monitors meta (the SDK's `MonitorsMeta`), null until `init()` resolves.

`createHmsSmokeStore()` and `createHmsFireStore()` (also from `@sjvair/map-sdk/stores`) load today's
NOAA HMS smoke and fire once, with no polling. Each has `status`, `init({ signal })`, and
`dispose()`; overlapping `init()` calls share one request, a failed load reports `error` with
`retry()` (on `status` and on every source), and a caller's abort rejects only that caller. A day
with no data is `ready` with an empty collection, so the legend still shows. The smoke store has one
`dataSource` for `hmsSmokePlugin` (scale `hms-smoke` / `smoke-density`, value the density). The fire
store has `groups` (nearby detections merged by `groupFires`, value the mean FRP) and `hotspots`
(each detection after `cleanFires`, value its FRP), for `hmsFirePlugin`'s `source` and `hotspots`
(scale `hms-fire` / `fire-frp`). Pass `{ messages }` to name the features with your own provider.

```ts
const smoke = createHmsSmokeStore();
const fires = createHmsFireStore();
await Promise.all([smoke.init(), fires.init()]);
map.addPlugin(hmsSmokePlugin({ source: smoke.dataSource, layerLabel: "Smoke" }));
map.addPlugin(
	hmsFirePlugin({ source: fires.groups, hotspots: fires.hotspots, layerLabel: "Fires" })
);
```

`createCollocationSitesStore({ monitors })` (also from `@sjvair/map-sdk/stores`) loads the
collocation sites once and joins each to a monitors store: `dataSource` follows that store's
readings as it polls and uses its scale. A site whose reference or collocated monitor isn't in the
monitors store (inactive, filtered out, or not loaded yet) still draws at its own position, in the
neutral color with "No reading". It has `status`, `init({ signal })`, and `dispose()`, like the
HMS stores; `init()` doesn't load the monitors store.

```ts
const monitors = createMonitorsStore();
const collocations = createCollocationSitesStore({ monitors });
await Promise.all([monitors.init("pm25"), collocations.init()]);
map.addPlugin(
	collocationSitesPlugin({ source: collocations.dataSource, layerLabel: "Collocation sites" })
);
map.addPlugin(monitorsPlugin({ source: monitors.dataSource, layerLabel: "Monitors" }));
```

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
ready and again after a basemap or theme change. For a plugin added to a ready map, `setup` runs
just after the current code finishes (a microtask), never inside the caller's code, so adding and
removing plugins from an `$effect` is safe. Everything added through `ctx` is removed on teardown,
and ids are namespaced per map. `features()` feeds the feature list, tooltip, and
summary; `legend()` the legend. A plugin's `tooltip` content sits under the feature's name; set
`tooltipShowsName` when the content shows the name itself (the monitor and collocation tooltips
do), and the name header is left out.

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

An item for a shape (a polygon or line) can carry its `geometry` and, optionally, its `bbox`
(`[west, south, east, north]`, from `geometryBbox(geometry)`). The list and the summary then count
it as in view when the shape overlaps the view, not only when its `lngLat` is inside it: a smoke
plume that fills the screen is listed even though its center is off-screen. Measure `bbox` once per
data load (both are tested on every move); without it the box is computed each time. Focusing such
a shape from the list while its `lngLat` is off-screen leaves the camera where it is, and its
tooltip pins at a point of the shape in view: the view's center (beside the list panel) when the
shape covers it, else a point inside its visible part. `map.focusedAnchor` is where the focused
tooltip pins, and `map.anchorFor(item)` gives that point for any item without moving the camera
(the hover tooltip uses it). `intersectsBounds(item, bounds)` is the in-view test. `shapesPlugin`
and the presets built on it set `geometry` and `bbox` already. Bounds across the antimeridian are
not handled.

A plugin can also add a MapLibre custom layer, such as a wind layer from a library you add
yourself, with `ctx.addCustomLayer(local, create)`. The host calls `create` with the namespaced id
(the layer must use it) and adds the object it returns as is, in the plugin's draw-order slot. It is
removed on teardown, `create` runs again after a basemap or theme change (return a fresh layer each
time), and `movePlugin` moves it with the plugin's other layers.

The cursor is a pointer over any interactive feature or cluster bubble. Where several plugins'
features are under the pointer, the hover tooltip shows the one whose plugin has the highest
`hoverPriority` (default 0), the topmost on a tie. Over a cluster bubble, the bubble's tooltip
shows unless a feature beneath belongs to a plugin with a higher `hoverPriority` than the
bubble's (collocation sites under monitor clusters). Clicks always go to the topmost, so a click
on a bubble still zooms into it. A plugin with `hoverable: false` never takes the hover: its
features show no hover tooltip or pointer cursor and are passed over as if they weren't drawn, so
whatever is beneath gets the hover. They are still clicked, returned by `featuresAt`, and pin
their tooltip when focused from the feature list. A plugin with `summarizeEmpty: false` has no
line in the view summary (the map's live region) while none of its features is in view, instead
of "0 <layer>"; `focusAreaPlugin` uses it.

A plugin's optional `drawnAt(lngLat)` says whether one of its markers is drawn exactly there (in
its zoom range and not in a cluster); `pointsPlugin({ marksPlaces: true })` provides it, and
`ctx.coveredAt(lngLat)` asks every other plugin on the map. The focus area uses it to leave out
its row under a school. `legend()` may also return `{ pluginId, title, symbols }`, a row per
symbol: `markup` (map-sdk's own inline SVG) beside its `label`.

```ts
import type { CustomLayerInterface, MapPlugin, PluginContext } from "@sjvair/map-sdk";

class WindLayer implements CustomLayerInterface {
	readonly type = "custom";
	constructor(readonly id: string) {}
	onAdd() {} // set up the library's renderer
	render() {} // draw one frame
	onRemove() {} // release it
}

const windPlugin: MapPlugin = {
	id: "wind",
	label: "Wind",
	setup(ctx: PluginContext) {
		ctx.addCustomLayer("particles", (id) => new WindLayer(id));
		return () => {};
	}
};
```

The root entry exports the types a plugin needs (`MapPlugin`, `PluginContext`, `FeatureHit`,
`FeatureListItem`, `LegendData`, `Providers`, `GlMapLike`, `CustomLayerInterface`,
`LayerSpecWithoutId`, `ThemeColors`, `ClusterLayers`, `ClusterLayerArgs`, `BlockingClick`,
`Hovered`) and the scale expressions the built-in plugins use (`colorExpression`,
`opacityExpression`, `levelKeyExpression`).

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

`pickWith: "modifier"` (an `addPlugin` option; default `"click"`) is for maps where a click should
only show the reading: a plain click or tap pins the card (use it with `MapView`'s `card`), and
Shift/Cmd/Ctrl-click, or the list's Space or Shift+Enter, toggles the feature in the selection (in
`single` mode it selects, or clears it when it's already selected). A tap never selects; the card's
own buttons do (below). Shift-click goes through MapLibre's box zoom, which takes every Shift press:
map-sdk turns a Shift release in place into the pick for `"modifier"` plugins only, and Shift-drag
still zooms to a box. With `pickWith: "click"`, a Shift-click still does nothing on the map.

`canSelect(next, ref)` (also an `addPlugin` option) refuses a user's pick before it shows: it gets
the selection the pick would produce and returns `true` to let it through or a message to refuse
it. A refused pick changes nothing and calls no `onselectionchange`; the map shows the message for
4 s and announces it to screen readers (`map.notice` holds it). It isn't asked for `setSelection`
or the selection bar's Clear.

```ts
map.addPlugin(plugin, {
	selectionMode: "multiple",
	pickWith: "modifier",
	canSelect: (next) => (next?.ids.length ?? 0) <= 3 || "Up to 3 monitors"
});
```

`map.togglePick(pluginId, ref)` is a user's toggle for your own controls (the card's Select or
Remove): the same rule, `canSelect`, and `onselectionchange` as a modifier-click.

`map.on("featureclick", ({ pluginId, ref, lngLat, properties }) => …)` fires for every click on a feature,
whatever the mode, and also for a pick in the feature list, so keyboard users get the same event;
`lngLat` is the click point. For a list pick it's where the item's tooltip pins: the item's
position, or for a shape whose label point is off-screen, a point of the shape in view.
`properties` is the feature's own data when its plugin gives it (`MapPlugin.properties(refKey)`;
`schoolsPlugin` does), and absent otherwise. It returns an unsubscribe function. For your own context menu, `map.featuresAt({ x, y })` returns the hits under
a canvas point, topmost first, and `map.featureForElement(element)` returns the hit for a row of
the feature list (an element with `data-mapsdk-ref`). Both return nothing while the map is
detached.

## Camera

`map.easeTo({ center, zoom?, minZoom? })` and `map.flyTo(...)` move the camera; `minZoom` means
"zoom in to at least this" (`max(current zoom, minZoom)`), and `zoom` wins when both are given.
`map.fitBounds({ west, south, east, north }, { padding?, maxZoom? })` fits a box. All three do
nothing while the map is detached or destroyed, and use no animation under `prefers-reduced-motion`.

```ts
map.flyTo({ center: [-119.7, 36.7], zoom: 16 });
map.easeTo({ center: monitor.lngLat, minZoom: 12 });
```

## Ready, and reaching the GL map

`map.ready` is reactive: true once the attached map's style has loaded, the map has gone idle
for the first time, and any queued plugin setups have run; false again on detach and while a
basemap switch reloads the style. Adding a plugin to a ready map leaves it true. Show a load screen
until it is true. `map.gl` is the attached GL map (or `null`), reactive.

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

- `metadata`: scales, entry-type labels and units, monitor type labels, location type labels
  (optional `locationTypeLabel`), and dataset attribution. The default reads the SJVAir API
  through `@sjvair/sdk`. `monitorTypeInterval(type)` is an
  optional method returning how often a monitor type reports (e.g. `"2 min"`); the monitor
  tooltip shows "(2 min avg)" under the entry-type label when it exists, and omits the note when a
  host's provider lacks it.
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

## Changes

### 0.1.0-beta.12

- **Schools and child care.** `schoolsPlugin` draws public schools, private schools, and child
  care sites from `getPesticideLocations`' features, passed through as they are: school-house
  badges with Lucide's school and baby glyphs, school-house count bubbles when zoomed out, a card
  (type, address, district, grades), a legend, and a `types` filter. Never selectable.
- **A focus point on a school** gives way to it: the school's badge stays inside the ring, and
  the focus point's list row is left out while the badge is drawn.
- **`featureclick`** carries `properties` when the clicked feature's plugin gives them
  (`schoolsPlugin`: the site's own, with `source` and `external_id`). Other plugins' events are
  unchanged.
- **New theme tokens:** `--school-marker` and `--child-care-marker`, fixed colors like the focus
  area's.
- **New message keys:** `mapsdk_location_type_unknown`, `mapsdk_school_address`,
  `mapsdk_school_district`, `mapsdk_school_grades`, `mapsdk_schools_cluster_line`,
  `mapsdk_schools_legend_school`.
- **New API:** `schoolsPlugin`, `SchoolsPluginOptions`, and in `./data` `SchoolsSource`,
  `SchoolLocationProperties`, `LocationType`; `MetadataProvider.locationTypeLabel` (optional);
  `MapPlugin.properties`, `MapPlugin.drawnAt`, `PointsOptions.marksPlaces`,
  `PluginContext.coveredAt`; a `symbols` form of `LegendData`; and two new `ThemeColors` keys
  (`schoolMarker`, `childCareMarker`). Code that builds a `ThemeColors` or a `PluginContext`
  object needs them.

### 0.1.0-beta.11

- **The focus area.** `focusAreaPlugin` marks the place a map is about: an area gets a two-tone
  outline and a wash outside it, and a place gets a two-tone ring with its label, listed as one row
  and clickable for a card with the label alone. `set()` changes it in place.
- **New theme tokens:** `--focus-area`, `--focus-area-casing`, and `--focus-area-wash`. They default
  to fixed colors (a slate line, a white casing and wash), since they sit on the basemap, which
  doesn't follow the page's theme.
- **New API:** `focusAreaPlugin`, `FocusAreaPlugin`, `FocusAreaPluginOptions`, `FocusGeometry`,
  `FeatureListItem.noReading`, `MapPlugin.summarizeEmpty`, and three new `ThemeColors` keys (`focusArea`, `focusAreaCasing`,
  `focusAreaWash`); code that builds a `ThemeColors` object needs them.

### 0.1.0-beta.10

- **Buttons on the pinned card.** `card={{ actions }}`: a snippet of the host's own buttons, given
  the card's feature, whether it's selected, and `toggle()` (the dashboard's Select and Remove).
- **Pick with a modifier.** `pickWith: "modifier"`: a plain click or tap only pins the card, and
  Shift/Cmd/Ctrl-click (or the list's Space or Shift+Enter) toggles the selection. Shift-click now
  reaches the map through MapLibre's box zoom for these plugins; Shift-drag still zooms to a box.
- **Refuse a pick before it shows.** `canSelect(next, ref)` returns `true` or a message: a refused
  pick changes nothing and calls no `onselectionchange`, and the map shows and announces the
  message for 4 s (`map.notice`). An empty message refuses quietly.
- **The feature list's Shift+Enter now picks additively**, as Shift-click on a row does (Enter
  alone replaces, Space adds or removes, as before). This applies with any `pickWith`.
- **New API:** `pickWith`, `canSelect`, `MapContext.togglePick`, `getPickWith`, `notice`,
  `CardOptions`, `CardContext`, and `GlMapLike.unproject` (for hosts that wrap the GL map).
- **Every `MapView` now has a `role="status"` element** (empty unless a pick is refused), so a host
  test that finds "the" status by role inside a map may need to narrow it.

### 0.1.0-beta.9

- **A map with `tooltip="pointer"` comes back after releasing WebGL.** Setting `MapView`'s
  `active` to `false` threw "Cannot read properties of null (reading 'off')" from the tooltip's
  zoom listener, and the map never drew again until a reload. It now releases and rebuilds cleanly.
  In 0.1.0-beta.7 and 0.1.0-beta.8; maps with the default `tooltip="pinned"` weren't affected.

### 0.1.0-beta.8

- **The pinned reading card.** `MapView`'s new `card` prop: a click or tap on a feature pins its
  card, which takes the pointer, has a Close button, and closes with Esc, Close, or a click
  elsewhere on the map. Focusing a feature-list row shows the same card, and Tab reaches it; closing
  it returns focus where it came from. With `card`, a tap always shows the reading: without
  it, a tap's emulated `mouseout` (Chromium, WebKit) still hides the hover card right after the
  tap, as before. Nothing changes without `card`, and with it, selection and `featureclick` behave
  as before.
- **New API:** `MapView`'s `card`, `MapContext.pinned` and `unpin()`. New message key for hosts
  with their own catalog: `mapsdk_card_close` ("Close").

### 0.1.0-beta.7

- **Plugins come back at once after a basemap switch.** After picking another basemap, monitors,
  fire, smoke and the other layers were missing until every tile of the new basemap had loaded
  and drawn (4–10 s on a slow connection). They are now added as soon as the new style loads, as
  sjvair.com's map does. A theme change while tiles are loading no longer waits either.
- **`config.telemetry: false`** turns off MapTiler's telemetry (its usage report) for the page,
  before the map is created. Sessions stay on, so billing by session and the tile cache are
  unchanged. By default nothing changes.
- **The feature list panel and the framed legend fit the map.** They were capped at the window's
  width less 2rem; inside a `MapView` they are now capped at the map's width less 2rem, so a small
  map on a wide screen doesn't overflow. MapView sets `--mapsdk-map-width` for this.

### 0.1.0-beta.6

- **A category reading is shown once.** When a feature's value is its category level's code, the
  list row, the tooltip, and the row's accessible name show only the level label. Smoke rows read
  "Smoke, Light" (was "light Light"), burn status "Burning Discouraged", and heat score
  "Moderate" (the 0–4 number is no longer shown). Number scales such as PM2.5 and fire power are
  unchanged, and a category value that matches no level is still shown.
- **New message key for hosts with their own catalog:** `mapsdk_list_row_level`
  (`"{name}, {level}"`).

### 0.1.0-beta.5

- **Shapes that cover the view are in view.** The feature list and the view summary count a shape
  when it overlaps the view, not only when its center (label point) is inside it. A smoke plume or
  a big region that fills the screen, with its center off-screen, now has a list row and is
  counted. Points are unchanged.
- **Focusing such a shape doesn't move the map.** Before, focusing a row panned to center the
  shape's label point (a plume's could be off Baja). Now the camera stays, and the tooltip pins at
  a point of the shape in view, with no move event. A shape whose label point is on screen still
  pans to it.
- **Hover tooltips** in `"pinned"` mode follow the same rule: a hovered shape whose label point is
  off-screen pins its tooltip inside the view instead of at the map's edge. If the map moves while
  the pointer rests on the shape, the pin is found again when the map settles.
- **`featureclick` from the list** (Enter on a row) reports that same in-view point for such a
  shape, instead of its off-screen label point. A handler that pans to `lngLat` no longer sends
  the map off to the shape's far-away center. Points and on-screen label points report their
  position, as before.
- **New API (all optional):** `FeatureListItem.geometry` and `.bbox`, `MapContext.focusedAnchor`
  and `.anchorFor(item)`, `geometryBbox`, `intersectsBounds`, and the `Bbox` type.

### 0.1.0-beta.4

Defaults from monitor-map 5.0's parity review against sjvair.com's map (4.3.0). Every map gets
them; none is an option.

- **Tooltip times** read like sjvair.com's map, in Pacific time: "4:00 pm Friday Nov 06, 2026"
  (was "Nov 6, 2026, 4:00 PM"). A device in another zone still gets " PT" after the time.
- **The cluster area line is back.** The monitor cluster tooltip's count line reads "3 monitors
  within a 22.619 mi² area". This reverses the 2026-11-04 parity decision of "no area line". The
  wording is new (sjvair.com said "covering"), and the area is the convex hull of the cluster's
  monitors, so clusters of four or more can differ from sjvair.com's number, which followed the
  monitors' order and could cross itself. No line when the area would read 0.000.
- **Fire tooltips are the reading box**: "Fire (MW)", the power in its level's color, beside the
  name and level; "Average" for a group of two or more. Fire values are cut off, not rounded, in
  the tooltip, the list and its accessible names. Every group names its count, a group of 1
  included ("1 fire detection").
- **Smoke plumes show no hover tooltip** and never take the hover from what is beneath them;
  focusing a plume from the feature list still pins its tooltip. This reverses part of milestone
  2's accessibility additions ("tooltips on smoke and fire"): fire keeps a tooltip.
- **Breaking for hosts with their own message catalog:** `mapsdk_hms_fire_detections` is now
  `mapsdk_hms_fire_detections_one` / `_other`. New keys: `mapsdk_hms_fire_box_header`,
  `mapsdk_hms_fire_box_header_no_units`, `mapsdk_hms_fire_average`, `mapsdk_level_with_units`,
  and `mapsdk_monitor_cluster_count_area_one` / `_other`.
- **New API:** `MapPlugin.hoverable`, `shapesPlugin`'s `hoverable`, `pointsPlugin`'s
  `truncateValues`, `FeatureListItem.truncate`, and `FireFeatureProperties`.

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
