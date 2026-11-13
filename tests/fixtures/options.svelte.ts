import type { OptionGroup, OptionValues } from "../../src/lib/options/types.js";

/** What an options toolbar test drives: the host's values, groups, and modes, plus the change log. */
export class ToolbarState {
	values = $state.raw<OptionValues>({});
	groups = $state.raw<OptionGroup[]>([]);
	defaults = $state.raw<OptionValues | undefined>(undefined);
	readonly = $state(false);
	basemapKey = $state<string | undefined>(undefined);
	calls: Array<{ values: OptionValues; changed: string[] }> = [];

	constructor(init: { groups: OptionGroup[]; values?: OptionValues; defaults?: OptionValues }) {
		this.groups = init.groups;
		this.values = init.values ?? {};
		this.defaults = init.defaults;
	}

	onchange = (values: OptionValues, changed: string[]) => {
		this.calls.push({ values, changed });
		this.values = values;
	};
}
