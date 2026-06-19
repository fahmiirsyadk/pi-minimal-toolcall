import { homedir } from "node:os";
import { join } from "node:path";

/** Environment variable that overrides the Pi agent directory used
 *  to resolve the config path. Matches the convention used by
 *  other Pi extensions (e.g. `pi-tool-display`). */
const PI_AGENT_DIR_ENV_VAR = "PI_CODING_AGENT_DIR";

function expandHomeDirectory(
	configuredDir: string,
	homeDirectory: string,
): string {
	if (configuredDir === "~") {
		return homeDirectory;
	}
	if (configuredDir.startsWith("~/") || configuredDir.startsWith("~\\")) {
		return join(homeDirectory, configuredDir.slice(2));
	}
	return configuredDir;
}

/**
 * Resolve the Pi agent directory. Honors `PI_CODING_AGENT_DIR` when
 * set (with `~` expansion); otherwise defaults to `~/.pi/agent`.
 * Testable via the `env` and `homeDirectory` params.
 */
export function resolvePiAgentDir(
	env: Record<string, string | undefined> = process.env,
	homeDirectory: string = homedir(),
): string {
	const configuredDir = env[PI_AGENT_DIR_ENV_VAR];
	if (!configuredDir) {
		return join(homeDirectory, ".pi", "agent");
	}
	return expandHomeDirectory(configuredDir, homeDirectory);
}
