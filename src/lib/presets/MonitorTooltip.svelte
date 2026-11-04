<script lang="ts">
	import type { FeatureListItem } from "../core/plugin.js";
	import type { FormatProvider } from "../data/format.js";
	import type { MessageProvider } from "../data/messages.js";
	import { NO_LEVEL } from "../data/scale.js";
	import type { Scale } from "../data/scale-types.js";
	import MonitorReadingBox from "./MonitorReadingBox.svelte";

	// Ported from monitor-map's MonitorTooltip: the reading in a level-colored box beside when it
	// was taken. The map tooltip shows the monitor's name above this.

	interface Props {
		item: FeatureListItem;
		/** ISO 8601, or null when unknown. */
		timestamp: string | null;
		scale: Scale | null;
		messages: MessageProvider;
		format: FormatProvider;
	}

	let { item, timestamp, scale, messages, format }: Props = $props();

	const level = $derived(item.level !== NO_LEVEL && item.level.color ? item.level : null);
	const reading = $derived.by(() => {
		const n = typeof item.value === "number" ? item.value : Number(item.value);
		if (item.value === null || item.value === "" || !Number.isFinite(n)) return null;
		return format.number(Math.round(n));
	});
	const time = $derived.by(() => {
		if (!timestamp || Number.isNaN(Date.parse(timestamp))) return null;
		const formatted = format.dateTime(timestamp);
		const zone = format.zoneLabel();
		return {
			at: zone ? messages("mapsdk_time_with_zone", { time: formatted, zone }) : formatted,
			ago: messages("mapsdk_monitor_updated", { when: format.relativeTime(timestamp) })
		};
	});
</script>

<div class="mapsdk-monitor-tip">
	<MonitorReadingBox
		color={level?.color ?? null}
		header={scale?.label ?? ""}
		value={reading ?? messages("mapsdk_no_reading")}
		large={reading !== null}
	/>
	<div class="mapsdk-monitor-detail">
		{#if time}
			<span>{time.at}</span>
		{/if}
		<span>{level ? level.label : messages("mapsdk_no_level")}</span>
		{#if time}
			<span class="text-base">{time.ago}</span>
		{/if}
	</div>
</div>

<style>
	.mapsdk-monitor-tip {
		display: flex;
		gap: 0.5rem;
	}

	.mapsdk-monitor-detail {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
</style>
