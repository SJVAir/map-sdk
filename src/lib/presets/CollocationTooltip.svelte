<script lang="ts">
	import type { FormatProvider } from "../data/format.js";
	import type { MessageProvider } from "../data/messages.js";
	import { levelFor, NO_LEVEL, numericValue } from "../data/scale.js";
	import type { Scale } from "../data/scale-types.js";
	import type { CollocationFeatureProperties } from "../data/types.js";
	import { formatValue } from "../ui/value-format.js";
	import MonitorReadingBox from "./MonitorReadingBox.svelte";

	// Ported from monitor-map's CollocationTooltip: the reference monitor's reading beside its
	// details, then the collocated monitor's with the box on the other side. Readings are whole
	// numbers cut off, not rounded, as monitor-map's. The reference monitor's name is shown here, not
	// above.

	interface Props {
		site: CollocationFeatureProperties;
		scale: Scale | null;
		messages: MessageProvider;
		format: FormatProvider;
		/** How often each monitor's type reports (e.g. "1 hour"); null leaves its note out. */
		referenceInterval: string | null;
		colocatedInterval: string | null;
	}

	let { site, scale, messages, format, referenceInterval, colocatedInterval }: Props = $props();

	function side(
		name: string | null,
		role: string,
		value: number | null,
		timestamp: string | null,
		interval: string | null
	) {
		const found = scale ? levelFor(value, scale) : NO_LEVEL;
		const level = found !== NO_LEVEL ? found : null;
		const n = numericValue(value);
		const valid = !!timestamp && !Number.isNaN(Date.parse(timestamp));
		const zone = format.zoneLabel();
		const formatted = valid ? format.dateTime(timestamp!) : null;
		return {
			name,
			role,
			color: level?.color || null,
			level: level ? level.label : messages("mapsdk_no_level"),
			reading: n === null ? null : formatValue(Math.trunc(n), 0, format),
			subheading: interval ? messages("mapsdk_collocation_interval_avg", { interval }) : undefined,
			at:
				formatted && zone
					? messages("mapsdk_time_with_zone", { time: formatted, zone })
					: formatted,
			ago: valid
				? messages("mapsdk_collocation_updated", { when: format.relativeTime(timestamp!) })
				: null
		};
	}

	const sides = $derived([
		side(
			site.name,
			messages("mapsdk_collocation_reference"),
			numericValue(site.value),
			site.timestamp ?? null,
			referenceInterval
		),
		side(
			site.colocatedName,
			messages("mapsdk_collocation_colocated"),
			site.colocatedValue,
			site.colocatedTimestamp,
			colocatedInterval
		)
	]);
</script>

<div class="mapsdk-collocation-tip">
	{#each sides as entry, i (i)}
		<div class="mapsdk-collocation-row" class:reverse={i === 1}>
			<MonitorReadingBox
				color={entry.color}
				header={scale?.label ?? ""}
				value={entry.reading ?? messages("mapsdk_no_reading")}
				large={entry.reading !== null}
				subheading={entry.subheading}
			/>
			<div class="mapsdk-collocation-detail">
				{#if entry.at}
					<span>{entry.at}</span>
				{/if}
				{#if entry.name}
					<span class="mapsdk-collocation-name text-lg">{entry.name}</span>
				{/if}
				<span>{entry.role}</span>
				<span>{entry.level}</span>
				{#if entry.ago}
					<span class="mapsdk-collocation-ago text-base">{entry.ago}</span>
				{/if}
			</div>
		</div>
	{/each}
</div>

<style>
	.mapsdk-collocation-tip {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.mapsdk-collocation-row {
		display: flex;
		gap: 0.5rem;
	}

	.mapsdk-collocation-row.reverse {
		flex-direction: row-reverse;
	}

	.mapsdk-collocation-detail {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.mapsdk-collocation-name {
		font-weight: 700;
		text-decoration: underline;
	}

	.mapsdk-collocation-ago {
		margin-top: auto;
	}
</style>
