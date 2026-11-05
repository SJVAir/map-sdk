<script lang="ts">
	import { formatValue } from "../ui/value-format.js";
	import type { FeatureListItem } from "../core/plugin.js";
	import type { FormatProvider } from "../data/format.js";
	import type { MessageProvider } from "../data/messages.js";
	import { NO_LEVEL, numericValue } from "../data/scale.js";
	import type { Scale } from "../data/scale-types.js";
	import MonitorReadingBox from "./MonitorReadingBox.svelte";

	// Ported from monitor-map's MonitorTooltip: the reading in a level-colored box beside when it
	// was taken, the monitor's name, and how long ago. The whole number is cut off, not rounded, as
	// monitor-map's is; the level label is added for accessibility. The map tooltip leaves its own
	// name header out.

	interface Props {
		item: FeatureListItem;
		/** ISO 8601, or null when unknown. */
		timestamp: string | null;
		scale: Scale | null;
		messages: MessageProvider;
		format: FormatProvider;
		/**
		 * How often the monitor's type reports (e.g. "1 hour"); null leaves the "(N avg)" note
		 * out.
		 */
		interval: string | null;
	}

	let { item, timestamp, scale, messages, format, interval }: Props = $props();

	// A level with an empty color shows its label in the neutral box.
	const level = $derived(item.level !== NO_LEVEL ? item.level : null);
	const reading = $derived.by(() => {
		const n = numericValue(item.value);
		return n === null ? null : formatValue(Math.trunc(n), 0, format);
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

<div class="mapsdk-monitor-tip mapsdk-tooltip-wide">
	<MonitorReadingBox
		color={level?.color || null}
		header={scale?.label ?? ""}
		value={reading ?? messages("mapsdk_no_reading")}
		large={reading !== null}
		subheading={interval ? messages("mapsdk_monitor_interval_avg", { interval }) : undefined}
	/>
	<div class="mapsdk-monitor-detail">
		{#if time}
			<span>{time.at}</span>
		{/if}
		<span class="mapsdk-monitor-name text-lg">{item.name}</span>
		<span>{level ? level.label : messages("mapsdk_no_level")}</span>
		{#if time}
			<span class="mapsdk-monitor-ago text-base">{time.ago}</span>
		{/if}
	</div>
</div>

<style>
	.mapsdk-monitor-tip {
		display: flex;
		gap: 0.5rem;
	}

	.mapsdk-monitor-name {
		font-weight: 700;
		text-decoration: underline;
	}

	.mapsdk-monitor-ago {
		margin-top: auto;
	}

	.mapsdk-monitor-detail {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
</style>
