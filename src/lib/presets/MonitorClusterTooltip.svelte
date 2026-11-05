<script lang="ts">
	import type { FormatProvider } from "../data/format.js";
	import type { MessageProvider } from "../data/messages.js";
	import type { MetadataProvider } from "../data/metadata.js";
	import { levelFor, NO_LEVEL, numericValue } from "../data/scale.js";
	import type { Scale } from "../data/scale-types.js";
	import type { MonitorFeatureProperties } from "../data/types.js";
	import type { ClusterInfo } from "../plugins/points-clusters.js";
	import { formatValue } from "../ui/value-format.js";
	import MonitorReadingBox from "./MonitorReadingBox.svelte";

	// Ported from monitor-map's MonitorClusterTooltip: the cluster's average in a level-colored
	// box beside its monitor type, count, and highest and lowest readings. The count and average
	// come from the bubble itself, so they show at once; the rest fills in from the cluster's
	// monitors. The average is a whole number and max and min are as reported, as monitor-map's.

	interface Props {
		cluster: ClusterInfo<MonitorFeatureProperties>;
		scale: Scale | null;
		messages: MessageProvider;
		format: FormatProvider;
		metadata: MetadataProvider;
	}

	let { cluster, scale, messages, format, metadata }: Props = $props();

	/** From the cluster's monitors, once they load. */
	interface Leaves {
		isSjvair: boolean;
		/** Readings only; monitors without one are left out. */
		values: number[];
	}

	let leaves = $state.raw<Leaves | null>(null);
	/** True once the monitors loaded or failed to. */
	let settled = $state(false);
	let typeLabel = $state<string | null>(null);

	$effect(() => {
		const controller = new AbortController();
		const { group } = cluster;
		leaves = null;
		settled = false;
		typeLabel = null;
		metadata.monitorTypeLabel(group, controller.signal).then(
			(label) => {
				if (!controller.signal.aborted) typeLabel = label === "unavailable" ? group : label;
			},
			() => {
				if (!controller.signal.aborted) typeLabel = group;
			}
		);
		cluster.leaves().then(
			(found) => {
				if (controller.signal.aborted) return;
				settled = true;
				if (found.length === 0) return;
				leaves = {
					isSjvair: found[0].props.isSjvair,
					values: found.flatMap(({ props }) => {
						const n = numericValue(props.value);
						return n === null ? [] : [n];
					})
				};
			},
			() => {
				if (!controller.signal.aborted) settled = true;
			}
		);
		return () => controller.abort();
	});

	/**
	 * The bubble's own average (its readings' sum over their count), unrounded: the level comes
	 * from it, as the bubble's color does. Only the number shown is rounded.
	 */
	const mean = $derived.by(() => {
		const sum = cluster.properties.sumValues;
		const count = cluster.properties.countValues;
		if (typeof sum !== "number" || typeof count !== "number" || count <= 0) return null;
		return sum / count;
	});
	const average = $derived(mean === null ? null : formatValue(mean, 0, format));
	const level = $derived.by(() => {
		if (mean === null || !scale) return null;
		const found = levelFor(mean, scale);
		return found !== NO_LEVEL ? found : null;
	});
	const units = $derived(scale?.units ?? "");
	const max = $derived(leaves?.values.length ? Math.max(...leaves.values) : null);
	const min = $derived(leaves?.values.length ? Math.min(...leaves.values) : null);
</script>

<div class="mapsdk-monitor-tip mapsdk-tooltip-wide">
	<MonitorReadingBox
		color={level?.color || null}
		header={scale?.label ?? ""}
		value={average ?? messages("mapsdk_no_reading")}
		large={average !== null}
		subheading={messages("mapsdk_monitor_cluster_average")}
	/>
	<div class="mapsdk-monitor-detail">
		{#if typeLabel !== null && settled}
			<span class="mapsdk-monitor-title text-lg">
				{messages(
					leaves?.isSjvair ? "mapsdk_monitor_cluster_title_sjvair" : "mapsdk_monitor_cluster_title",
					{ type: typeLabel }
				)}
			</span>
		{/if}
		<span>{messages("mapsdk_monitor_cluster_count", { count: cluster.pointCount })}</span>
		<span>{level ? level.label : messages("mapsdk_no_level")}</span>
		{#if max !== null && min !== null}
			<span class="mapsdk-monitor-extremes text-base">
				{messages("mapsdk_monitor_cluster_max", {
					value: formatValue(max, undefined, format),
					units
				})}
			</span>
			<span class="text-base">
				{messages("mapsdk_monitor_cluster_min", {
					value: formatValue(min, undefined, format),
					units
				})}
			</span>
		{/if}
	</div>
</div>

<style>
	.mapsdk-monitor-tip {
		display: flex;
		gap: 0.5rem;
	}

	.mapsdk-monitor-title {
		font-weight: 700;
	}

	.mapsdk-monitor-extremes {
		margin-top: auto;
	}

	.mapsdk-monitor-detail {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
</style>
