import en from "./messages/en.json";

type Catalog = Omit<typeof en, "$schema">;
type Literal = keyof Catalog;
type PluralBase<K> = K extends `${infer B}_one` ? B : never;

/** Every catalog key, plus the base key of each `_one`/`_other` plural message. */
export type MessageKey = Literal | PluralBase<Literal>;
export type MessageParams = Record<string, string | number>;
export type MessageProvider = (key: MessageKey, params?: MessageParams) => string;

const catalog: Record<string, string> = en;
const plurals = new Intl.PluralRules("en-US");

function interpolate(template: string, params?: MessageParams): string {
	if (!params) return template;
	return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
		Object.hasOwn(params, name) ? String(params[name]) : whole
	);
}

export const defaultMessages: MessageProvider = (key, params) => {
	let resolved: string = key;
	if (!Object.hasOwn(catalog, key) && typeof params?.count === "number") {
		const variant = `${key}_${plurals.select(params.count) === "one" ? "one" : "other"}`;
		if (Object.hasOwn(catalog, variant)) resolved = variant;
	}
	return interpolate(catalog[resolved] ?? key, params);
};
