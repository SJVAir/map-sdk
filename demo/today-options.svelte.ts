import type { FeatureCollection, Geometry } from "geojson";
import {
	hmsFirePlugin,
	hmsOptions,
	hmsSmokePlugin,
	monitorsOptions,
	monitorsPlugin,
	settingsGroup,
	type MapContext,
	type OptionGroup,
	type OptionValues
} from "../src/lib/index.js";
import type { DataSource, MonitorFeatureProperties } from "../src/lib/data/index.js";
import type {
	createHmsFireStore,
	createHmsSmokeStore,
	createMonitorsStore
} from "../src/lib/stores/index.js";
import { ICONS } from "./toolbar-icons.js";

type MonitorsStore = ReturnType<typeof createMonitorsStore>;

/** The monitors the toolbar's rows leave on: their type, Inactive, and Inside. */
class FilteredMonitors implements DataSource<MonitorFeatureProperties> {
	#store: MonitorsStore;
	#values: () => OptionValues;
	constructor(store: MonitorsStore, values: () => OptionValues) {
		this.#store = store;
		this.#values = values;
	}
	get status() {
		return this.#store.dataSource.status;
	}
	get scale() {
		return this.#store.dataSource.scale;
	}
	features = $derived.by((): FeatureCollection<Geometry, MonitorFeatureProperties> | null => {
		const all = this.#store.dataSource.features;
		if (!all) return null;
		const v = this.#values();
		return {
			...all,
			features: all.features.filter(({ properties: p }) => {
				if (v[`type:${p.type}`] === false) return false;
				if (!p.isActive && v.inactive !== true) return false;
				if (p.location === "inside" && v.inside !== true) return false;
				return true;
			})
		};
	});
}

/**
 * The demo's monitor-map setup driven by an options toolbar, as a host wires one: the host owns
 * the values, builds the groups from map-sdk's presets, and applies each change to its plugins.
 */
export class TodayOptions {
	#own = $state.raw<OptionValues>({});
	/**
	 * The host's values, with a type that arrived after the defaults were made counted as on (as a
	 * host fills defaults in for data that loads later).
	 */
	values = $derived.by((): OptionValues => {
		const filled: OptionValues = {};
		for (const type of this.#types) filled[`type:${type}`] = true;
		return { ...filled, ...this.#own };
	});
	defaults = $state.raw<OptionValues>({});
	#map: MapContext;
	#monitors: MonitorsStore;
	#smoke: ReturnType<typeof createHmsSmokeStore>;
	#fire: ReturnType<typeof createHmsFireStore>;
	#presets: ReturnType<typeof monitorsOptions>;
	#filtered: FilteredMonitors;
	#types = $derived.by(() => {
		const seen: string[] = [];
		for (const f of this.#monitors.dataSource.features?.features ?? []) {
			if (!seen.includes(f.properties.type)) seen.push(f.properties.type);
		}
		return seen.sort();
	});

	constructor(
		map: MapContext,
		stores: {
			monitors: MonitorsStore;
			smoke: ReturnType<typeof createHmsSmokeStore>;
			fire: ReturnType<typeof createHmsFireStore>;
		}
	) {
		this.#map = map;
		this.#monitors = stores.monitors;
		this.#smoke = stores.smoke;
		this.#fire = stores.fire;
		this.#presets = monitorsOptions(map);
		this.#filtered = new FilteredMonitors(stores.monitors, () => this.values);
	}

	groups = $derived.by((): OptionGroup[] => {
		const features = this.#monitors.dataSource.features?.features ?? [];
		const monitors = this.#presets.groups({
			types: this.#types,
			pollutants: [...this.#monitors.availableEntryTypes],
			pollutant: (this.values.pollutant as string | undefined) ?? this.#monitors.entryType,
			hasInactive: features.some((f) => !f.properties.isActive),
			hasInside: features.some((f) => f.properties.location === "inside"),
			icons: { monitors: ICONS.monitors }
		});
		const fire = hmsOptions(this.#map, { icon: ICONS.fire });
		const layers: OptionGroup = {
			id: "layers",
			label: this.#map.messages("mapsdk_options_layers"),
			icon: ICONS.layers,
			cluster: "options",
			rows: [fire.row]
		};
		const settings = settingsGroup(this.#map, {
			icon: ICONS.settings,
			clusters: { icon: ICONS.clusters },
			basemap: { icons: { basemap: ICONS.basemap, theme: ICONS.theme } },
			reset: { icon: ICONS.reset }
		});
		return [...monitors.groups, layers, ...settings.groups];
	});

	/** The first values: every preset's defaults. */
	start(): void {
		const monitors = this.#presets.groups({
			types: this.#types,
			pollutants: [...this.#monitors.availableEntryTypes],
			pollutant: this.#monitors.entryType
		});
		const defaults = {
			...monitors.defaults,
			pollutant: this.#monitors.entryType ?? "pm25",
			...hmsOptions(this.#map).defaults,
			...settingsGroup(this.#map).defaults
		};
		this.defaults = defaults;
		this.apply(defaults, Object.keys(defaults));
	}

	/** A change from the toolbar (or the host): store it, then apply what changed. */
	apply = (values: OptionValues, changed: string[]): void => {
		this.#own = values;
		const map = this.#map;
		if (changed.includes("pollutant") && typeof values.pollutant === "string") {
			if (values.pollutant !== this.#monitors.entryType)
				this.#monitors.entryTypeFor(values.pollutant);
		}
		if (changed.includes("basemap") && typeof values.basemap === "string") {
			map.basemap.select(values.basemap);
		}
		if (changed.includes("clustered") || !map.plugins.some((p) => p.id === "monitors")) {
			map.removePlugin("monitors");
			map.addPlugin(
				monitorsPlugin({
					source: this.#filtered,
					layerLabel: "Monitors",
					id: "monitors",
					selectable: true,
					selectedStyle: "enlarge",
					clustered: values.clustered !== false
				}),
				{ selectionMode: "single" }
			);
		}
		if (changed.includes("fireAndSmoke")) {
			if (values.fireAndSmoke) {
				if (!map.plugins.some((p) => p.id === "hms-smoke")) {
					map.addPlugin(
						hmsSmokePlugin({
							source: this.#smoke.dataSource,
							layerLabel: "Smoke",
							id: "hms-smoke"
						}),
						{ before: "collocation-sites" }
					);
					map.addPlugin(
						hmsFirePlugin({
							source: this.#fire.groups,
							hotspots: this.#fire.hotspots,
							layerLabel: "Fires",
							id: "hms-fire"
						}),
						{ before: "collocation-sites" }
					);
				}
			} else {
				map.removePlugin("hms-smoke");
				map.removePlugin("hms-fire");
			}
		}
	};
}
