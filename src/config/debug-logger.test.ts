import assert from "node:assert/strict";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, before, beforeEach, test } from "node:test";
import {
	debugLog,
	isDebugEnabled,
	setDebugEnabled,
	setDebugPath,
} from "./index.js";

let tempDir = "";
let logFile = "";
let lastTempDir = "";

function makeTempDir(): string {
	const dir = join(
		tmpdir(),
		`pi-mtc-debug-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(dir, { recursive: true });
	return dir;
}

beforeEach(() => {
	tempDir = makeTempDir();
	logFile = join(tempDir, "debug.log");
	lastTempDir = tempDir;
});

afterEach(() => {
	setDebugEnabled(false);
	// Disable the global state regardless of test outcome.
	if (lastTempDir && existsSync(lastTempDir)) {
		try {
			rmSync(lastTempDir, { recursive: true, force: true });
		} catch {
			// ignore
		}
	}
});

// Suppress the unused `before` import warning.
void before;

test("setDebugEnabled(false) (default): debugLog is a no-op (no file written)", () => {
	setDebugPath(tempDir, logFile);
	setDebugEnabled(false);
	assert.equal(isDebugEnabled(), false);
	debugLog("scope", "message", { x: 1 });
	// The marker line is not appended when the log is disabled, so
	// the file shouldn't exist (we never enabled it).
	assert.ok(!existsSync(logFile), `log file should not exist: ${logFile}`);
});

test("setDebugEnabled(true): file is created; first line is the 'debug enabled' marker", () => {
	setDebugPath(tempDir, logFile);
	setDebugEnabled(true);
	assert.equal(isDebugEnabled(), true);
	assert.ok(existsSync(logFile));
	const content = readFileSync(logFile, "utf-8");
	assert.match(content, /debug enabled/);
});

test("debugLog: writes `[ts] [scope] message` lines; payload is JSON-stringified", () => {
	setDebugPath(tempDir, logFile);
	setDebugEnabled(true);
	debugLog("session", "session_start", { id: "abc", n: 42 });
	const content = readFileSync(logFile, "utf-8");
	// The marker line + the debugLog line.
	const lines = content.trim().split("\n");
	assert.equal(lines.length, 2);
	assert.match(lines[0]!, /debug enabled/);
	assert.match(lines[1]!, /\[session\] session_start \{"id":"abc","n":42\}/);
});

test("debugLog: a write failure (e.g. directory removed mid-test) does not throw", () => {
	setDebugPath(tempDir, logFile);
	setDebugEnabled(true);
	// Remove the parent directory; subsequent appendFileSync fails.
	rmSync(tempDir, { recursive: true, force: true });
	assert.doesNotThrow(() => {
		debugLog("scope", "after-rm");
	});
});

test("setDebugPath: redirects subsequent writes to the new path", () => {
	const otherDir = makeTempDir();
	const otherFile = join(otherDir, "other.log");
	setDebugPath(tempDir, logFile);
	setDebugEnabled(true);
	debugLog("scope", "in first dir");
	setDebugPath(otherDir, otherFile);
	// After setDebugPath, enabled is reset to false; re-enable for
	// the new path.
	setDebugEnabled(true);
	debugLog("scope", "in second dir");
	assert.ok(existsSync(otherFile));
	const otherContent = readFileSync(otherFile, "utf-8");
	assert.match(otherContent, /debug enabled/);
	assert.match(otherContent, /in second dir/);
	assert.ok(!otherContent.includes("in first dir"));
	// Cleanup the second dir.
	try {
		rmSync(otherDir, { recursive: true, force: true });
	} catch {
		// ignore
	}
});

// Suppress unused-import warnings for writeFileSync (kept for future use).
void writeFileSync;
