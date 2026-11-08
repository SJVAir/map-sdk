<script lang="ts">
	import type { FeatureListItem } from "../core/plugin.js";
	import type { FormatProvider } from "../data/format.js";
	import type { MessageProvider } from "../data/messages.js";
	import { NO_LEVEL, numericValue } from "../data/scale.js";
	import { formatValue } from "../ui/value-format.js";
	import MonitorReadingBox from "./MonitorReadingBox.svelte";

	// A fire's power in the monitors' reading box, beside its name and level. The value is cut
	// off, not rounded, so it never reads as the next level (9.96 MW shows 9.9 beside "<10").
	// No detection time: a satellite pass isn't when the fire started or whether it still burns.

	interface Props {
		item: FeatureListItem;
		/** How many detections a group averages; null for a single detection. */
		count: number | null;
		messages: MessageProvider;
		format: FormatProvider;
	}

	let { item, count, messages, format }: Props = $props();

	const level = $derived(item.level !== NO_LEVEL ? item.level : null);
	const value = $derived.by(() => {
		const n = numericValue(item.value);
		return n === null ? null : formatValue(n, item.precision, format, true);
	});
	const header = $derived(
		item.units
			? messages("mapsdk_hms_fire_box_header", { units: item.units })
			: messages("mapsdk_hms_fire_box_header_no_units")
	);
</script>

<div class="mapsdk-fire-tip mapsdk-tooltip-wide">
	<MonitorReadingBox
		color={level?.color || null}
		{header}
		value={value ?? messages("mapsdk_no_reading")}
		large={value !== null}
		subheading={count !== null && count >= 2 ? messages("mapsdk_hms_fire_average") : undefined}
	/>
	<div class="mapsdk-fire-detail">
		<span class="mapsdk-fire-name text-lg">{item.name}</span>
		<span>
			{level
				? messages("mapsdk_level_with_units", { level: level.label, units: item.units })
				: messages("mapsdk_no_level")}
		</span>
	</div>
</div>

<style>
	.mapsdk-fire-tip {
		display: flex;
		gap: 0.5rem;
	}

	.mapsdk-fire-name {
		font-weight: 700;
	}

	.mapsdk-fire-detail {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
</style>
