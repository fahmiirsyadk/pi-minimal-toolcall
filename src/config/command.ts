import {
	DEFAULT_MINIMAL_TOOLCALL_CONFIG,
	detectPreset,
	getConfigPath,
	getPresetConfig,
	loadConfig,
	parsePreset,
	saveConfig,
} from "./index.js";

/** A minimal `ctx.ui.notify`-shaped callback. */
export type CommandNotify = (
	message: string,
	kind: "info" | "warning" | "error",
) => void;

/**
 * Handle a `/minimal-toolcall` subcommand. Pure: takes the raw
 * `args` string from the extension's command handler, a notify
 * callback, and an optional config file path (default
 * `getConfigPath()`). Returns nothing; the side effect is one or
 * more `notify` calls + a possible `saveConfig`.
 *
 * Subcommands:
 * - `show` — print the effective config + preset + path.
 * - `reset` — write the default config to disk.
 * - `preset <calm|verbose|minimal>` — write the named preset to disk.
 *
 * On any `saveConfig` failure, the error is surfaced via `notify`
 * with kind `"error"`. The notify is skipped (no-op) when
 * `notify` is undefined — useful for tests.
 */
export function runMinimalToolcallCommand(
	args: string,
	notify: CommandNotify | undefined,
	configFile: string = getConfigPath(),
): void {
	const notifySafe: CommandNotify = notify ?? (() => {});
	const raw = args.trim();
	const space = raw.indexOf(" ");
	const sub = space === -1 ? raw : raw.slice(0, space);
	const rest = space === -1 ? "" : raw.slice(space + 1).trim();

	if (sub === "show") {
		const { config, error } = loadConfig(configFile);
		const preset = detectPreset(config);
		const lines = [
			`path: ${configFile}`,
			`preset: ${preset}`,
			`showWorkingIndicator: ${config.showWorkingIndicator}`,
			`toolsExpandedByDefault: ${config.toolsExpandedByDefault}`,
			`hiddenThinkingLabel: ${JSON.stringify(config.hiddenThinkingLabel)}`,
			`registerToolOverrides: ${JSON.stringify(config.registerToolOverrides)}`,
			`batchToolsEnabled: ${config.batchToolsEnabled}`,
		];
		if (error) lines.push(`error: ${error}`);
		notifySafe(lines.join("\n"), "info");
		return;
	}

	if (sub === "reset") {
		const result = saveConfig(DEFAULT_MINIMAL_TOOLCALL_CONFIG, configFile);
		if (result.success) {
			notifySafe(`Reset to defaults. Reload to apply: ${configFile}`, "info");
		} else {
			notifySafe(`Reset failed: ${result.error}`, "error");
		}
		return;
	}

	if (sub === "preset") {
		const name = parsePreset(rest);
		if (!name) {
			notifySafe(
				`Unknown preset: ${JSON.stringify(rest)}. Valid: calm, verbose, minimal.`,
				"error",
			);
			return;
		}
		const result = saveConfig(getPresetConfig(name), configFile);
		if (result.success) {
			notifySafe(
				`Applied preset "${name}". Reload to apply: ${configFile}`,
				"info",
			);
		} else {
			notifySafe(`Preset apply failed: ${result.error}`, "error");
		}
		return;
	}

	notifySafe(
		"Usage: /minimal-toolcall show | reset | preset <calm|verbose|minimal>",
		"info",
	);
}
