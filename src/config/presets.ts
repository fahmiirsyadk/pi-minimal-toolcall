import {
	DEFAULT_MINIMAL_TOOLCALL_CONFIG,
	type MinimalToolcallConfig,
	PRESET_NAMES,
	type PresetName,
} from "./types.js";

/** Parse a user-typed preset name. Trims, lowercases, and matches
 *  against `PRESET_NAMES`. Returns `undefined` for empty / unknown. */
export function parsePreset(raw: string): PresetName | undefined {
	const n = raw.trim().toLowerCase();
	if (!n) return undefined;
	return (PRESET_NAMES as readonly string[]).includes(n)
		? (n as PresetName)
		: undefined;
}

function cloneConfig(c: MinimalToolcallConfig): MinimalToolcallConfig {
	return {
		...c,
		registerToolOverrides: { ...c.registerToolOverrides },
		spinnerFrames: [...c.spinnerFrames],
		customToolOverrides: Object.fromEntries(
			Object.entries(c.customToolOverrides).map(([k, v]) => [k, { ...v }]),
		),
	};
}

const PRESET_CONFIGS: Record<PresetName, MinimalToolcallConfig> = {
	calm: {
		...DEFAULT_MINIMAL_TOOLCALL_CONFIG,
		registerToolOverrides: {
			...DEFAULT_MINIMAL_TOOLCALL_CONFIG.registerToolOverrides,
		},
		spinnerFrames: [...DEFAULT_MINIMAL_TOOLCALL_CONFIG.spinnerFrames],
		customToolOverrides: {},
	},
	verbose: {
		...DEFAULT_MINIMAL_TOOLCALL_CONFIG,
		// Calm-defaults differences (from plan 002).
		showWorkingIndicator: true,
		toolsExpandedByDefault: true,
		// Rendering differences (plan 003).
		showArgOnSummary: "always",
		showDiffSuffix: true,
		writeExpandMode: "both",
		expandedBodyMaxLines: 600,
		spinnerIntervalMs: 120,
		registerToolOverrides: {
			...DEFAULT_MINIMAL_TOOLCALL_CONFIG.registerToolOverrides,
		},
		spinnerFrames: [...DEFAULT_MINIMAL_TOOLCALL_CONFIG.spinnerFrames],
		customToolOverrides: {},
	},
	minimal: {
		...DEFAULT_MINIMAL_TOOLCALL_CONFIG,
		showWorkingIndicator: false,
		toolsExpandedByDefault: false,
		hiddenThinkingLabel: "",
		// Rendering differences.
		showArgOnSummary: "never",
		showDiffSuffix: false,
		showErrorMark: false,
		writeExpandMode: "summary",
		expandedBodyMaxLines: 80,
		spinnerIntervalMs: 50,
		registerToolOverrides: {
			...DEFAULT_MINIMAL_TOOLCALL_CONFIG.registerToolOverrides,
		},
		spinnerFrames: [...DEFAULT_MINIMAL_TOOLCALL_CONFIG.spinnerFrames],
		customToolOverrides: {},
	},
};

/** Return a fresh clone of the preset's config. Callers can mutate the
 *  returned object without affecting subsequent `getPresetConfig`
 *  calls. */
export function getPresetConfig(preset: PresetName): MinimalToolcallConfig {
	return cloneConfig(PRESET_CONFIGS[preset]);
}

/** Return the preset whose config matches `config` exactly, or
 *  `"custom"` if no preset matches. The match is structural (deep
 *  equality), not by reference. */
export function detectPreset(
	config: MinimalToolcallConfig,
): PresetName | "custom" {
	for (const p of PRESET_NAMES) {
		if (configsEqual(config, PRESET_CONFIGS[p])) return p;
	}
	return "custom";
}

function customToolOverridesEqual(
	a: MinimalToolcallConfig,
	b: MinimalToolcallConfig,
): boolean {
	const aKeys = Object.keys(a.customToolOverrides).sort();
	const bKeys = Object.keys(b.customToolOverrides).sort();
	if (aKeys.length !== bKeys.length) return false;
	for (let i = 0; i < aKeys.length; i++) {
		const k = aKeys[i];
		const bk = bKeys[i];
		if (k === undefined || bk === undefined) return false;
		if (k !== bk) return false;
		const ae = a.customToolOverrides[k];
		const be = b.customToolOverrides[k];
		if (!ae || !be) return false;
		if (ae.enabled !== be.enabled || ae.outputMode !== be.outputMode)
			return false;
	}
	return true;
}

function spinnerFramesEqual(
	a: readonly string[],
	b: readonly string[],
): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		if (a[i] !== b[i]) return false;
	}
	return true;
}

function configsEqual(
	a: MinimalToolcallConfig,
	b: MinimalToolcallConfig,
): boolean {
	if (a.version !== b.version) return false;
	if (a.showWorkingIndicator !== b.showWorkingIndicator) return false;
	if (a.toolsExpandedByDefault !== b.toolsExpandedByDefault) return false;
	if (a.hiddenThinkingLabel !== b.hiddenThinkingLabel) return false;
	if (a.batchToolsEnabled !== b.batchToolsEnabled) return false;
	if (a.groupingMode !== b.groupingMode) return false;
	if (a.expandedBodyMaxLines !== b.expandedBodyMaxLines) return false;
	if (a.spinnerIntervalMs !== b.spinnerIntervalMs) return false;
	if (!spinnerFramesEqual(a.spinnerFrames, b.spinnerFrames)) return false;
	if (a.showArgOnSummary !== b.showArgOnSummary) return false;
	if (a.writeExpandMode !== b.writeExpandMode) return false;
	if (a.showDiffSuffix !== b.showDiffSuffix) return false;
	if (a.showErrorMark !== b.showErrorMark) return false;
	if (a.debug !== b.debug) return false;
	const ao = a.registerToolOverrides;
	const bo = b.registerToolOverrides;
	if (
		ao.read !== bo.read ||
		ao.grep !== bo.grep ||
		ao.find !== bo.find ||
		ao.ls !== bo.ls ||
		ao.bash !== bo.bash ||
		ao.edit !== bo.edit ||
		ao.write !== bo.write
	) {
		return false;
	}
	if (!customToolOverridesEqual(a, b)) return false;
	return true;
}
