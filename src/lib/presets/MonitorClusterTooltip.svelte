<script lang="ts">
	import { area } from "@turf/area";
	import { convertArea } from "@turf/helpers";
	import type { FormatProvider } from "../data/format.js";
	import type { MessageProvider } from "../data/messages.js";
	import type { MetadataProvider } from "../data/metadata.js";
	import { levelFor, NO_LEVEL } from "../data/scale.js";
	import type { Scale } from "../data/scale-types.js";
	import type { MonitorFeatureProperties } from "../data/types.js";
	import type { ClusterInfo } from "../plugins/points.svelte.js";
	import MonitorReadingBox from "./MonitorReadingBox.svelte";

	// Ported from monitor-map's MonitorClusterTooltip: the cluster's average in a level-colored
	// box beside its monitor type, count, covered area, and highest and lowest readings.

	interface Props {
		cluster: ClusterInfo<MonitorFeatureProperties>;
		scale: Scale | null;
		messages: MessageProvider;
		format: FormatProvider;
		metadata: MetadataProvider;
	}

	let { cluster, scale, messages, format, metadata }: Props = $props();

	interface Summary {
		typeLabel: string;
		isSjvair: boolean;
		/** Readings only; monitors without one are left out. */
		values: number[];
		coverage: string | null;
	}

	let summary = $state.raw<Summary | null>(null);

	$effect(() => {
		const controller = new AbortController();
		const type = cluster.group;
		Promise.all([cluster.leaves(), metadata.monitorTypeLabel(type, controller.signal)]).then(
			([leaves, label]) => {
				if (controller.signal.aborted || leaves.length === 0) return;
				summary = {
					typeLabel: label === "unavailable" ? type : label,
					isSjvair: leaves[0].props.isSjvair,
					values: leaves.flatMap(({ props }) => {
						const n = typeof props.value === "number" ? props.value : Number(props.value);
						return props.value === null || props.value === "" || !Number.isFinite(n) ? [] : [n];
					}),
					coverage: coverage(leaves.map((leaf) => leaf.lngLat))
				};
			},
			() => {}
		);
		return () => controller.abort();
	});

	/**
	 * The area of the polygon through the monitors, in square miles, as monitor-map computes it
	 * (the ring in leaf order, closed only for three monitors); null when it is zero.
	 */
	function coverage(coords: Array<[number, number]>): string | null {
		const ring = [...coords];
		if (ring.length === 3) ring.push(ring[0]);
		const squareMeters = area({ type: "Polygon", coordinates: [ring] });
		return squareMeters > 0 ? convertArea(squareMeters, "meters", "miles").toFixed(3) : null;
	}

	const average = $derived.by(() => {
		const values = summary?.values ?? [];
		return values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null;
	});
	const level = $derived.by(() => {
		if (average === null || !scale) return null;
		const found = levelFor(average, scale);
		return found !== NO_LEVEL && found.color ? found : null;
	});
	const units = $derived(scale?.units ?? "");
	const max = $derived(summary?.values.length ? Math.max(...summary.values) : null);
	const min = $derived(summary?.values.length ? Math.min(...summary.values) : null);
</script>

{#if summary}
	<div class="mapsdk-monitor-tip">
		<MonitorReadingBox
			color={level?.color ?? null}
			header={scale?.label ?? ""}
			value={average === null ? messages("mapsdk_no_reading") : format.number(average)}
			large={average !== null}
			subheading={messages("mapsdk_monitor_cluster_average")}
		/>
		<div class="mapsdk-monitor-detail">
			<span class="mapsdk-monitor-title text-lg">
				{messages(
					summary.isSjvair ? "mapsdk_monitor_cluster_title_sjvair" : "mapsdk_monitor_cluster_title",
					{ type: summary.typeLabel }
				)}
			</span>
			<span>
				{summary.coverage
					? messages("mapsdk_monitor_cluster_coverage", {
							count: cluster.pointCount,
							area: summary.coverage
						})
					: messages("mapsdk_monitor_cluster_count", { count: cluster.pointCount })}
			</span>
			<span>{level ? level.label : messages("mapsdk_no_level")}</span>
			{#if max !== null && min !== null}
				<span class="text-base">
					{messages("mapsdk_monitor_cluster_max", { value: format.number(max), units })}
				</span>
				<span class="text-base">
					{messages("mapsdk_monitor_cluster_min", { value: format.number(min), units })}
				</span>
			{/if}
		</div>
	</div>
{/if}

<style>
	.mapsdk-monitor-tip {
		display: flex;
		gap: 0.5rem;
	}

	.mapsdk-monitor-title {
		font-weight: 700;
	}

	.mapsdk-monitor-detail {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
</style>
