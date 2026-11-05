<script lang="ts">
	import MapView from "../../src/lib/view/MapView.svelte";
	import type { MapContext } from "../../src/lib/core/create-map.svelte.js";
	import type { FeatureListOptions } from "../../src/lib/view/list-placement.js";

	// The test harness's rerender replaces every prop, which recreates the GL map; this changes
	// only `featureList`.
	let { map }: { map: MapContext } = $props();
	let featureList = $state<boolean | FeatureListOptions>(true);

	export function setFeatureList(value: boolean | FeatureListOptions) {
		featureList = value;
	}
</script>

<MapView {map} class="wide-map" controls="engine" {featureList} />
