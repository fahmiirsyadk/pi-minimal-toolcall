import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { resolvePiAgentDir } from "./agent-dir.js";
import {
	CUSTOM_TOOL_OUTPUT_MODES,
	type CustomToolOverrideConfig,
	DEFAULT_MINIMAL_TOOLCALL_CONFIG,
	GROUPING_MODES,
	type MinimalToolcallConfig,
	SHOW_ARG_MODES,
	TOOL_OVERRIDE_NAMES,
	type ToolOverrideOwnership,
	WRITE_EXPAND_MODES,
} from "./types.js";

const CONFIG_DIR = join(
	resolvePiAgentDir(),
	"extensions",
	"pi-minimal-toolcall",
);
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

export function getConfigPath(): string {
	return CONFIG_FILE;
}

// --- Normalization helpers -----------------------------------------------

function toRecord(value: unknown): Record<string, unknown> {
	if (typeof value === "object" && value !== null && !Array.isArray(value)) {
		return value as Record<string, unknown>;
	}
	return {};
}

function toBoolean(value: unknown, fallback: boolean): boolean {
	return typeof value === "boolean" ? value : fallback;
}

function clampNumber(
	value: unknown,
	min: number,
	max: number,
	fallback: number,
): number {
	if (typeof value !== "number" || Number.isNaN(value)) return fallback;
	const rounded = Math.floor(value);
	if (rounded < min) return min;
	if (rounded > max) return max;
	return rounded;
}

function toGroupingMode(value: unknown): MinimalToolcallConfig["groupingMode"] {
	return GROUPING_MODES.includes(value as MinimalToolcallConfig["groupingMode"])
		? (value as MinimalToolcallConfig["groupingMode"])
		: DEFAULT_MINIMAL_TOOLCALL_CONFIG.groupingMode;
}

function toShowArgMode(
	value: unknown,
): MinimalToolcallConfig["showArgOnSummary"] {
	return SHOW_ARG_MODES.includes(
		value as MinimalToolcallConfig["showArgOnSummary"],
	)
		? (value as MinimalToolcallConfig["showArgOnSummary"])
		: DEFAULT_MINIMAL_TOOLCALL_CONFIG.showArgOnSummary;
}

function toWriteExpandMode(
	value: unknown,
): MinimalToolcallConfig["writeExpandMode"] {
	return WRITE_EXPAND_MODES.includes(
		value as MinimalToolcallConfig["writeExpandMode"],
	)
		? (value as MinimalToolcallConfig["writeExpandMode"])
		: DEFAULT_MINIMAL_TOOLCALL_CONFIG.writeExpandMode;
}

function toCustomToolOutputMode(
	value: unknown,
): CustomToolOverrideConfig["outputMode"] {
	return CUSTOM_TOOL_OUTPUT_MODES.includes(
		value as CustomToolOverrideConfig["outputMode"],
	)
		? (value as CustomToolOverrideConfig["outputMode"])
		: "summary";
}

function normalizeToolOverrideOwnership(
	rawOverrides: unknown,
): ToolOverrideOwnership {
	const source = toRecord(rawOverrides);
	const defaults = DEFAULT_MINIMAL_TOOLCALL_CONFIG.registerToolOverrides;
	const overrides = { ...defaults };
	for (const toolName of TOOL_OVERRIDE_NAMES) {
		overrides[toolName] = toBoolean(source[toolName], defaults[toolName]);
	}
	return overrides;
}

function isBuiltInToolOverrideName(toolName: string): boolean {
	return (TOOL_OVERRIDE_NAMES as readonly string[]).includes(toolName);
}

function normalizeCustomToolOverrideEntry(
	rawEntry: unknown,
): CustomToolOverrideConfig | undefined {
	if (typeof rawEntry === "boolean") {
		return {
			enabled: rawEntry,
			outputMode: "summary",
		};
	}
	if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) {
		return undefined;
	}
	const source = toRecord(rawEntry);
	return {
		enabled: toBoolean(source["enabled"], true),
		outputMode: toCustomToolOutputMode(source["outputMode"]),
	};
}

/** Maximum number of `customToolOverrides` entries. A user is
 *  unlikely to opt in to 256 distinct custom tools; the cap guards
 *  against accidental JSON imports with thousands of entries. Beyond
 *  the cap, further entries are silently dropped during normalization
 *  (their config is preserved on disk; only the runtime map is
 *  bounded). */
export const MAX_CUSTOM_TOOL_OVERRIDES = 256;

function normalizeCustomToolOverrides(
	rawOverrides: unknown,
): Record<string, CustomToolOverrideConfig> {
	const source = toRecord(rawOverrides);
	const overrides: Record<string, CustomToolOverrideConfig> = {};
	for (const [rawToolName, rawEntry] of Object.entries(source)) {
		const toolName = rawToolName.trim();
		// Reject underscore-prefixed metadata keys (e.g. `_comment_*`)
		// and built-in tool names — the latter are configured via
		// `registerToolOverrides`, not here.
		if (!toolName || toolName.startsWith("_")) continue;
		if (isBuiltInToolOverrideName(toolName)) continue;
		const normalized = normalizeCustomToolOverrideEntry(rawEntry);
		if (!normalized) continue;
		overrides[toolName] = normalized;
		if (Object.keys(overrides).length >= MAX_CUSTOM_TOOL_OVERRIDES) break;
	}
	return overrides;
}

function normalizeSpinnerFrames(raw: unknown): readonly string[] {
	if (!Array.isArray(raw)) return DEFAULT_MINIMAL_TOOLCALL_CONFIG.spinnerFrames;
	const frames = raw.filter(
		(f): f is string => typeof f === "string" && f.length > 0,
	);
	return frames.length > 0
		? frames
		: DEFAULT_MINIMAL_TOOLCALL_CONFIG.spinnerFrames;
}

/** Coerce any `unknown` to a fully-typed `MinimalToolcallConfig`. */
export function normalizeConfig(raw: unknown): MinimalToolcallConfig {
	const source = toRecord(raw);
	return {
		version: 1,
		toolsExpandedByDefault: toBoolean(
			source["toolsExpandedByDefault"],
			DEFAULT_MINIMAL_TOOLCALL_CONFIG.toolsExpandedByDefault,
		),
		hiddenThinkingLabel:
			typeof source["hiddenThinkingLabel"] === "string"
				? source["hiddenThinkingLabel"]
				: DEFAULT_MINIMAL_TOOLCALL_CONFIG.hiddenThinkingLabel,
		registerToolOverrides: normalizeToolOverrideOwnership(
			source["registerToolOverrides"],
		),
		batchToolsEnabled: toBoolean(
			source["batchToolsEnabled"],
			DEFAULT_MINIMAL_TOOLCALL_CONFIG.batchToolsEnabled,
		),
		groupingMode: toGroupingMode(source["groupingMode"]),
		expandedBodyMaxLines: clampNumber(
			source["expandedBodyMaxLines"],
			0,
			2000,
			DEFAULT_MINIMAL_TOOLCALL_CONFIG.expandedBodyMaxLines,
		),
		spinnerIntervalMs: clampNumber(
			source["spinnerIntervalMs"],
			20,
			2000,
			DEFAULT_MINIMAL_TOOLCALL_CONFIG.spinnerIntervalMs,
		),
		spinnerFrames: normalizeSpinnerFrames(source["spinnerFrames"]),
		showArgOnSummary: toShowArgMode(source["showArgOnSummary"]),
		writeExpandMode: toWriteExpandMode(source["writeExpandMode"]),
		showDiffSuffix: toBoolean(
			source["showDiffSuffix"],
			DEFAULT_MINIMAL_TOOLCALL_CONFIG.showDiffSuffix,
		),
		showErrorMark: toBoolean(
			source["showErrorMark"],
			DEFAULT_MINIMAL_TOOLCALL_CONFIG.showErrorMark,
		),
		customToolOverrides: normalizeCustomToolOverrides(
			source["customToolOverrides"],
		),
		debug: toBoolean(source["debug"], DEFAULT_MINIMAL_TOOLCALL_CONFIG.debug),
	};
}

function cloneDefaultConfig(): MinimalToolcallConfig {
	return {
		...DEFAULT_MINIMAL_TOOLCALL_CONFIG,
		registerToolOverrides: {
			...DEFAULT_MINIMAL_TOOLCALL_CONFIG.registerToolOverrides,
		},
		spinnerFrames: [...DEFAULT_MINIMAL_TOOLCALL_CONFIG.spinnerFrames],
		customToolOverrides: {},
	};
}

function cloneConfig(config: MinimalToolcallConfig): MinimalToolcallConfig {
	return normalizeConfig(config);
}

// --- Cache (fingerprint-keyed) ------------------------------------------

let cachedFile: string | undefined;
let cachedFingerprint: string | undefined;
let cachedResult: ConfigLoadResult | undefined;

function cloneLoadResult(result: ConfigLoadResult): ConfigLoadResult {
	return {
		...result,
		config: cloneConfig(result.config),
	};
}

function getFingerprint(configFile: string): string {
	try {
		const stats = statSync(configFile);
		// Include the inode when present so two writes within the
		// filesystem's mtime resolution still produce distinct
		// fingerprints. Most filesystems expose `ino`; some (notably
		// Windows) do not — fall back to mtime+size.
		const ino = (stats as { ino?: number }).ino;
		return ino !== undefined
			? `${stats.mtimeMs}:${stats.size}:${ino}`
			: `${stats.mtimeMs}:${stats.size}`;
	} catch {
		return "missing";
	}
}

function invalidateCache(): void {
	cachedFile = undefined;
	cachedFingerprint = undefined;
	cachedResult = undefined;
}

// --- Public load / save API ---------------------------------------------

export interface ConfigLoadResult {
	config: MinimalToolcallConfig;
	error?: string;
}

export interface ConfigSaveResult {
	success: boolean;
	error?: string;
}

/**
 * Load + normalize the config. Caches by `(path, mtimeMs, size, ino)`
 * fingerprint so repeated `session_start` calls don't re-read the
 * file. The inode prevents a stale read when two writes land within
 * the filesystem's mtime resolution. Returns defaults if the file
 * is missing; returns defaults + an error message if the file is
 * present but malformed.
 */
export function loadConfig(configFile: string = CONFIG_FILE): ConfigLoadResult {
	const fingerprint = getFingerprint(configFile);
	if (
		cachedResult &&
		cachedFile === configFile &&
		cachedFingerprint === fingerprint
	) {
		return cloneLoadResult(cachedResult);
	}

	let result: ConfigLoadResult;
	if (!existsSync(configFile)) {
		result = { config: cloneDefaultConfig() };
	} else {
		try {
			const rawText = readFileSync(configFile, "utf-8");
			const rawConfig = JSON.parse(rawText) as unknown;
			result = { config: normalizeConfig(rawConfig) };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			result = {
				config: cloneDefaultConfig(),
				error: `Failed to parse ${configFile}: ${message}`,
			};
		}
	}

	cachedFile = configFile;
	cachedFingerprint = fingerprint;
	cachedResult = cloneLoadResult(result);
	return cloneLoadResult(result);
}

/**
 * Normalize + write the config atomically (tmp + rename). Invalidates
 * the fingerprint cache on success. On error, attempts to unlink the
 * tmp file before returning the error.
 */
export function saveConfig(
	config: MinimalToolcallConfig,
	configFile: string = CONFIG_FILE,
): ConfigSaveResult {
	const normalized = normalizeConfig(config);
	const tmpFile = `${configFile}.tmp`;
	try {
		mkdirSync(dirname(configFile), { recursive: true });
		writeFileSync(tmpFile, `${JSON.stringify(normalized, null, 2)}\n`, "utf-8");
		renameSync(tmpFile, configFile);
		invalidateCache();
		return { success: true };
	} catch (error) {
		try {
			if (existsSync(tmpFile)) unlinkSync(tmpFile);
		} catch {
			// Ignore cleanup errors.
		}
		const message = error instanceof Error ? error.message : String(error);
		return {
			success: false,
			error: `Failed to save ${configFile}: ${message}`,
		};
	}
}
