import { existsSync } from "node:fs";
import { loadConfig, normalizeConfig } from "./loader.js";
import type { MinimalToolcallConfig } from "./types.js";

export interface DoctorDiagnostic {
	level: "ok" | "info" | "warning";
	message: string;
}

export interface DoctorReport {
	configFile: string;
	config: MinimalToolcallConfig;
	source: "file" | "defaults";
	diagnostics: DoctorDiagnostic[];
}

/** Walk the resolved config and flag any values that are likely footguns.
 *  The checks are intentionally conservative — they warn but never
 *  rewrite the config. */
export function runDoctor(
	configFile: string,
	options: { source?: "file" | "defaults" } = {},
): DoctorReport {
	const { config } = loadConfig(configFile);
	// The loader returns `{ config: defaults }` with no `error` for a
	// missing file — same shape as a successful load of a default-only
	// file. Distinguish the two by checking the filesystem: `source`
	// is "file" only when the file actually exists (or `options.source`
	// is explicitly set).
	const source: "file" | "defaults" =
		options.source ?? (existsSync(configFile) ? "file" : "defaults");
	const diagnostics: DoctorDiagnostic[] = [];

	// spinnerIntervalMs < 20ms pegs a CPU; the loader clamps to 20 already,
	// but a value of exactly 20 still wastes cycles.
	if (config.spinnerIntervalMs < 50) {
		diagnostics.push({
			level: "warning",
			message: `spinnerIntervalMs is ${config.spinnerIntervalMs}ms (< 50ms) — likely to peg the CPU.`,
		});
	}
	// expandedBodyMaxLines <= 0 collapses every expanded view to a footer.
	if (config.expandedBodyMaxLines <= 0) {
		diagnostics.push({
			level: "warning",
			message: "expandedBodyMaxLines is 0 — expanded tool output will show only a 'N earlier lines not shown' footer.",
		});
	}
	// showArgOnSummary + showArgOnSummary='always' on a multi-tool row is
	// informational only (no bug), so this stays at 'info'.
	if (config.showArgOnSummary === "always" && config.groupingMode === "proximity") {
		diagnostics.push({
			level: "info",
			message:
				"showArgOnSummary='always' with groupingMode='proximity' will show the latest arg on every multi-tool row. Consider 'single-only' for a calmer look.",
		});
	}
	// Per-tool ownership: warn if everything is disabled (the package
	// becomes a no-op).
	const overrides = config.registerToolOverrides;
	const allDisabled = Object.values(overrides).every((v) => v === false);
	if (allDisabled) {
		diagnostics.push({
			level: "warning",
			message:
				"All 7 built-in tools are disabled in registerToolOverrides — pi-minimal-toolcall will not render anything.",
		});
	}
	// Batch tools disabled — informational.
	if (!config.batchToolsEnabled) {
		diagnostics.push({
			level: "info",
			message: "batchToolsEnabled=false — read_files / edit_files / grep_files / find_files are not registered.",
		});
	}
	// customToolOverrides: the field is parsed but not yet rendered (see
	// index.ts). Warn if the user has set entries, so they don't expect
	// visible behavior.
	const customCount = Object.keys(config.customToolOverrides).length;
	if (customCount > 0) {
		diagnostics.push({
			level: "warning",
			message: `customToolOverrides has ${customCount} entr${customCount === 1 ? "y" : "ies"} — the field is loaded but does not yet affect rendering (awaiting SDK support).`,
		});
	}

	return {
		configFile,
		config,
		source,
		diagnostics,
	};
}

/** Format a doctor report as a single multi-line string suitable for
 *  `ctx.ui.notify` or stdout. */
export function formatDoctorReport(report: DoctorReport): string {
	const lines: string[] = [];
	lines.push(`pi-minimal-toolcall doctor`);
	lines.push(`  config: ${report.configFile}`);
	lines.push(`  source: ${report.source}`);
	lines.push(`  schema version: ${report.config.version}`);
	lines.push("");
	lines.push("Resolved config:");
	lines.push(JSON.stringify(serializeForDisplay(report.config), null, 2));
	if (report.diagnostics.length > 0) {
		lines.push("");
		lines.push("Diagnostics:");
		for (const d of report.diagnostics) {
			const prefix = d.level === "warning" ? "⚠ " : d.level === "info" ? "ℹ " : "✓ ";
			lines.push(`  ${prefix}${d.message}`);
		}
	} else {
		lines.push("");
		lines.push("No issues found.");
	}
	return lines.join("\n");
}

function serializeForDisplay(config: MinimalToolcallConfig): unknown {
	// Round-trip through normalizeConfig to drop transient runtime
	// fields and ensure the printed shape matches what's on disk.
	return normalizeConfig(config);
}
