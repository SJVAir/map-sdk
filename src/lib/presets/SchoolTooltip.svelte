<script lang="ts">
	import type { MessageProvider } from "../data/messages.js";
	import type { SchoolLocationProperties } from "../data/types.js";

	// A school or child care site's card, below its name: its type, then each detail the data
	// has. A missing, null, or blank value's line is left out. No enrollment or capacity (the
	// user, 2026-11-12).

	interface Props {
		site: SchoolLocationProperties;
		/** The type's label (metadata, else the feature's `type_label`, else "Location"). */
		typeLabel: string;
		messages: MessageProvider;
	}

	let { site, typeLabel, messages }: Props = $props();

	const text = (value: string | null | undefined) => value?.trim() || null;

	const lines = $derived.by(() => {
		const out: string[] = [typeLabel];
		const address = text(site.address);
		const city = text(site.city);
		if (address) {
			out.push(city ? messages("mapsdk_school_address", { address, city }) : address);
		}
		const district = text(site.school_district);
		if (district) out.push(messages("mapsdk_school_district", { district }));
		const grades = text(site.grade_span);
		if (grades) out.push(messages("mapsdk_school_grades", { grades }));
		return out;
	});
</script>

<div class="mapsdk-school-tip text-sm">
	{#each lines as line, i (i)}
		<p class={["mapsdk-school-line", i === 0 && "mapsdk-school-type"]}>{line}</p>
	{/each}
</div>

<style>
	.mapsdk-school-tip {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}

	.mapsdk-school-line {
		margin: 0;
	}

	.mapsdk-school-type {
		font-weight: 600;
	}
</style>
