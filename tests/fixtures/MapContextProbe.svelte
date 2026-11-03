<script lang="ts">
	import { getMapContext } from "../../src/lib/core/context.js";

	const map = getMapContext();
</script>

<span data-testid="map-context-probe">{map.uid}</span>
