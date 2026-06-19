import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { resolvePiAgentDir } from "./agent-dir.js";

const DEFAULT_DEBUG_DIR = join(
	resolvePiAgentDir(),
	"extensions",
	"pi-minimal-toolcall",
	"debug",
);
const DEFAULT_DEBUG_FILE = join(DEFAULT_DEBUG_DIR, "debug.log");

let enabled = false;
let debugDir = DEFAULT_DEBUG_DIR;
let debugFile = DEFAULT_DEBUG_FILE;

/** Override the debug log path. Intended for tests — production code
 *  should rely on the default path. Resets `enabled` so the next
 *  `setDebugEnabled(true)` re-creates the file at the new path. */
export function setDebugPath(dir: string, file: string): void {
	debugDir = dir;
	debugFile = file;
	enabled = false;
}

/** Toggle the debug log. When transitioning from `false` to `true`,
 *  the debug directory is created (if missing) and a "debug
 *  enabled" marker line is appended. When `false`, subsequent
 *  `debugLog` calls are no-ops. Failures during enable are silent —
 *  debug logging must not crash the extension. */
export function setDebugEnabled(value: boolean): void {
	enabled = value;
	if (enabled) {
		try {
			if (!existsSync(debugDir)) mkdirSync(debugDir, { recursive: true });
			appendFileSync(
				debugFile,
				`--- ${new Date().toISOString()} debug enabled ---\n`,
			);
		} catch {
			// Disable on any I/O failure; debug logging must never
			// throw into the extension's hot path.
			enabled = false;
		}
	}
}

export function isDebugEnabled(): boolean {
	return enabled;
}

/** Append a `[ts] [scope] message [jsonPayload]` line to the debug
 *  log. No-op when the debug log is disabled. Errors during write
 *  are swallowed (the debug log is best-effort). */
export function debugLog(
	scope: string,
	message: string,
	payload?: unknown,
): void {
	if (!enabled) return;
	const ts = new Date().toISOString();
	const line =
		payload !== undefined
			? `[${ts}] [${scope}] ${message} ${safeStringify(payload)}\n`
			: `[${ts}] [${scope}] ${message}\n`;
	try {
		appendFileSync(debugFile, line);
	} catch {
		// Swallow — debug logging must not crash the extension.
	}
}

function safeStringify(value: unknown): string {
	try {
		return JSON.stringify(value);
	} catch {
		return "[unserializable]";
	}
}

/** Append a "clear" marker line. Useful for test cleanup so the
 *  test's writes can be distinguished from previous runs. */
export function clearDebugLog(): void {
	try {
		appendFileSync(debugFile, `\n--- ${new Date().toISOString()} clear ---\n`);
	} catch {
		// ignore
	}
}
