import type { Snippet } from "svelte";
import { createMap, pointsPlugin, shapesLens, shapesPlugin } from "../../src/lib/index.js";
import { createDefaultMetadata } from "../../src/lib/data/metadata.js";
import { staticSource } from "../../src/lib/data/index.js";
import { componentSnippet } from "../../src/lib/presets/monitors.js";
import {
	NOTICE_SCALE,
	pesticideData,
	SECTIONS_REF,
	TOWNSHIPS_REF,
	withPesticideScales,
	type NoticeProps,
	type UseProps
} from "../pesticide-data.js";
import NoticeCard from "./NoticeCard.svelte";
import UseCard from "./UseCard.svelte";

/** The demo's pesticide map: townships below zoom 11 with the lens, sections from 11, notices. */
export function createPesticideMap(maptilerKey: string, legendNote: Snippet) {
	const data = pesticideData();
	const map = createMap({
		config: {
			maptilerKey,
			initialView: { center: data.center, zoom: 9, bearing: 0, pitch: 0 }
		},
		metadata: withPesticideScales(createDefaultMetadata())
	});
	const townships = shapesPlugin<UseProps>({
		id: "townships",
		source: staticSource(data.townships, TOWNSHIPS_REF),
		layerLabel: "Townships",
		mode: "choropleth",
		noFigure: "outline",
		zoomRange: { max: 11 },
		legendUnits: "lbs per township",
		legendNote,
		tooltip: (_item, props) => componentSnippet(UseCard, { props, kind: "township" })
	});
	const lens = shapesLens<UseProps>({
		id: "lens",
		parents: townships,
		source: staticSource(data.sections, SECTIONS_REF),
		block: data.block,
		parentOf: data.parentOf,
		layerLabel: "Sections",
		noFigure: "outline",
		fillOpacity: 0.85,
		legendUnits: "lbs per section",
		tooltip: (_item, props) => componentSnippet(UseCard, { props, kind: "section" })
	});
	const sections = shapesPlugin<UseProps>({
		id: "sections",
		source: staticSource(data.sections, SECTIONS_REF),
		layerLabel: "Sections",
		mode: "choropleth",
		noFigure: "outline",
		zoomRange: { min: 11 },
		legendUnits: "lbs per section",
		tooltip: (_item, props) => componentSnippet(UseCard, { props, kind: "section" })
	});
	const notices = pointsPlugin<NoticeProps>({
		id: "notices",
		source: staticSource(data.notices, NOTICE_SCALE),
		layerLabel: "Spray notices",
		count: { property: "count" },
		cluster: { radius: 40, maxZoom: 8 },
		legendDisplay: "blocks",
		tooltip: (_item, props) => componentSnippet(NoticeCard, { props })
	});
	for (const plugin of [townships, lens, sections, notices]) map.addPlugin(plugin);
	/** For e2e: every notice's count, summed. */
	const noticeTotal = data.notices.features.reduce((n, f) => n + f.properties.count, 0);
	return { map, lens, townships, noticeTotal };
}
