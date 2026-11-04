// The scale shapes come from the SDK (the server's shared scale types); `Level` is this
// library's public name for the SDK's `ScaleLevel`. Runtime helpers live in scale.ts.
import type { Scale, ScaleLevel, ScaleSource } from "@sjvair/sdk/meta/types";

export type { Scale, ScaleSource };
export type Level = ScaleLevel;

export interface ScaleRef {
	dataset: string;
	entryType: string;
}
