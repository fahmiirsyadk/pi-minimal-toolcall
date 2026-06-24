import assert from "node:assert/strict";
import { test } from "node:test";
import { resolvePiAgentDir } from "../src/config/agent-dir.ts";

test("agent-dir: unset env → ~/.pi/agent under home", () => {
	assert.equal(
		resolvePiAgentDir({}, "/home/alice"),
		"/home/alice/.pi/agent",
	);
});

test("agent-dir: env='~' → home", () => {
	assert.equal(resolvePiAgentDir({ PI_CODING_AGENT_DIR: "~" }, "/home/bob"), "/home/bob");
});

test("agent-dir: env='~/sub' → home/sub", () => {
	assert.equal(
		resolvePiAgentDir({ PI_CODING_AGENT_DIR: "~/sub" }, "/home/bob"),
		"/home/bob/sub",
	);
});

test("agent-dir: env='~/deep/nested' → home/deep/nested", () => {
	assert.equal(
		resolvePiAgentDir(
			{ PI_CODING_AGENT_DIR: "~/deep/nested" },
			"/home/bob",
		),
		"/home/bob/deep/nested",
	);
});

test("agent-dir: env='~\\sub' (Windows-style) → home/sub", () => {
	assert.equal(
		resolvePiAgentDir({ PI_CODING_AGENT_DIR: "~\\sub" }, "/home/bob"),
		"/home/bob/sub",
	);
});

test("agent-dir: absolute env path passes through unchanged", () => {
	assert.equal(
		resolvePiAgentDir(
			{ PI_CODING_AGENT_DIR: "/var/lib/pi" },
			"/home/bob",
		),
		"/var/lib/pi",
	);
});

test("agent-dir: env='~user' is NOT treated as ~ (no expansion)", () => {
	// Tilde must be at the start AND followed by `/` or `\`. `~user`
	// is a literal username reference on POSIX; we don't expand it.
	assert.equal(
		resolvePiAgentDir(
			{ PI_CODING_AGENT_DIR: "~user/agent" },
			"/home/bob",
		),
		"~user/agent",
	);
});

test("agent-dir: empty-string env falls through to home/.pi/agent", () => {
	// Treat empty as "unset" — `!configuredDir` covers both undefined
	// and empty.
	assert.equal(
		resolvePiAgentDir({ PI_CODING_AGENT_DIR: "" }, "/home/bob"),
		"/home/bob/.pi/agent",
	);
});
