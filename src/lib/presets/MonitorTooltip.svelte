<script lang="ts">
	import { darken, readableColor } from "color2k";
	import type { FeatureListItem } from "../core/plugin.js";
	import type { FormatProvider } from "../data/format.js";
	import type { MessageProvider } from "../data/messages.js";
	import { NO_LEVEL } from "../data/scale.js";
	import type { Scale } from "../data/scale-types.js";

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
	const box = $derived(level ? boxStyle(level.color) : "");
	const reading = $derived.by(() => {
		const n = typeof item.value === "number" ? item.value : Number(item.value);
		if (item.value === null || item.value === "" || !Number.isFinite(n)) return null;
		return format.number(Math.round(n));
	});
	const time = $derived.by(() => {
		if (!timestamp || Number.isNaN(Date.parse(timestamp))) return null;
		const formatted = format.dateTime(timestamp);
		const zone = format.zoneLabel();
		return zone ? messages("mapsdk_time_with_zone", { time: formatted, zone }) : formatted;
	});

	/** The level color with a darker border and readable text; unparseable → the neutral box. */
	function boxStyle(color: string): string {
		try {
			return `background:${color};border-color:${darken(color, 0.1)};color:${readableColor(color)}`;
		} catch {
			return "";
		}
	}
</script>

<div class="mapsdk-monitor-tip">
	<div class="mapsdk-monitor-box" class:neutral={!box} style={box}>
		{#if scale?.label}
			<span class="text-base">{scale.label}</span>
		{/if}
		<span class="mapsdk-monitor-value" class:text-3xl={reading !== null}>
			{reading ?? messages("mapsdk_no_reading")}
		</span>
	</div>
	<div class="mapsdk-monitor-detail">
		{#if time}
			<span>{time}</span>
		{/if}
		<span>{level ? level.label : messages("mapsdk_no_level")}</span>
	</div>
</div>

<style>
	.mapsdk-monitor-tip {
		display: flex;
		gap: 0.5rem;
	}

	.mapsdk-monitor-box {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 0.25rem;
		border: 4px solid;
		border-radius: calc(var(--radius-control, var(--radius)) / 2);
		text-align: center;
		white-space: nowrap;
	}

	.mapsdk-monitor-box.neutral {
		border-color: var(--border);
		background: var(--muted);
		color: var(--muted-foreground);
	}

	.mapsdk-monitor-value {
		font-weight: 700;
	}

	.mapsdk-monitor-detail {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
</style>
