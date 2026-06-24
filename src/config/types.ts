// --- Mode-const tuples + literal types -----------------------------------

export const TOOL_OVERRIDE_NAMES = [
	"read",
	"grep",
	"find",
	"ls",
	"bash",
	"edit",
	"write",
] as const;
export type ToolOverrideName = (typeof TOOL_OVERRIDE_NAMES)[number];

export const GROUPING_MODES = ["proximity", "consecutive", "none"] as const;
export type GroupingMode = (typeof GROUPING_MODES)[number];

export const SHOW_ARG_MODES = ["single-only", "never", "always"] as const;
export type ShowArgMode = (typeof SHOW_ARG_MODES)[number];

export const WRITE_EXPAND_MODES = ["content", "summary", "both"] as const;
export type WriteExpandMode = (typeof WRITE_EXPAND_MODES)[number];

export const CUSTOM_TOOL_OUTPUT_MODES = [
	"hidden",
	"summary",
	"preview",
] as const;
export type CustomToolOutputMode = (typeof CUSTOM_TOOL_OUTPUT_MODES)[number];

// --- The full config shape -----------------------------------------------

export interface ToolOverrideOwnership {
	read: boolean;
	grep: boolean;
	find: boolean;
	ls: boolean;
	bash: boolean;
	edit: boolean;
	write: boolean;
}

export interface CustomToolOverrideConfig {
	/** Whether to decorate this non-builtin extension tool. */
	enabled: boolean;
	/** Output mode for this tool's result when enabled. */
	outputMode: CustomToolOutputMode;
}

/**
 * The complete runtime config for `@whitespace/pi-minimal-toolcall`.
 * Schema version is a literal `1` so the compiler catches drift when
 * the shape changes. See `DEFAULT_MINIMAL_TOOLCALL_CONFIG` for the
 * shipped defaults; those defaults match the package's pre-config
 * hardcoded behavior so a user with no config file sees no change.
 */
export interface MinimalToolcallConfig {
	/** Schema version for forward-compat migrations. Bumped on
	 *  breaking changes to the config shape. */
	version: 1;
	// --- Tool-call scope only (not global UI state) -----------------
	toolsExpandedByDefault: boolean;
	hiddenThinkingLabel: string;
	// --- Tool ownership (consumed by plan 002) -------------------------
	registerToolOverrides: ToolOverrideOwnership;
	/** Batch tools (read_files / edit_files / grep_files / find_files). */
	batchToolsEnabled: boolean;
	// --- Rendering knobs (consumed by plan 003) ------------------------
	groupingMode: GroupingMode;
	expandedBodyMaxLines: number;
	spinnerIntervalMs: number;
	spinnerFrames: readonly string[];
	showArgOnSummary: ShowArgMode;
	writeExpandMode: WriteExpandMode;
	showDiffSuffix: boolean;
	showErrorMark: boolean;
	// --- Custom tool overrides (consumed by plan 004) ------------------
	customToolOverrides: Record<string, CustomToolOverrideConfig>;
	// --- Diagnostics (consumed by plan 004) ----------------------------
	debug: boolean;
}

/**
 * The shipped defaults. The values are chosen to be bit-identical to
 * the package's pre-config hardcoded behavior so a user with no config
 * file (or an empty one) sees no change.
 */
export const DEFAULT_MINIMAL_TOOLCALL_CONFIG: MinimalToolcallConfig = {
	version: 1,
	// Tool-call-scope defaults. Working indicator is global UI
	// state, not ours — we don't touch it.
	toolsExpandedByDefault: false,
	hiddenThinkingLabel: "thinking",
	// All seven built-in tools are overridden by default. Per-tool
	// opt-out arrives in plan 002.
	registerToolOverrides: {
		read: true,
		grep: true,
		find: true,
		ls: true,
		bash: true,
		edit: true,
		write: true,
	},
	batchToolsEnabled: true,
	// Rendering defaults — match today's behavior.
	groupingMode: "proximity",
	expandedBodyMaxLines: 200,
	spinnerIntervalMs: 80,
	spinnerFrames: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
	showArgOnSummary: "single-only",
	writeExpandMode: "content",
	showDiffSuffix: true,
	showErrorMark: true,
	customToolOverrides: {},
	debug: false,
};
