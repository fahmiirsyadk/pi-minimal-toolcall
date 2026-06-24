import assert from "node:assert/strict";
import { test } from "node:test";
import {
	DEFAULT_MINIMAL_TOOLCALL_CONFIG,
	type MinimalToolcallConfig,
} from "../src/config/index.ts";
import {
	clearSessionSpinnerOptions,
	getSessionConfig,
	getSessionIdForToolCall,
	getSessionSpinnerOptions,
	registerToolCallSession,
	setSessionConfig,
	unregisterToolCallSession,
} from "../src/spinner-state.ts";

const ALTERNATE: MinimalToolcallConfig = {
	...DEFAULT_MINIMAL_TOOLCALL_CONFIG,
	spinnerIntervalMs: 200,
	spinnerFrames: ["a", "b", "c"],
	expandedBodyMaxLines: 50,
};

test("spinner-state: setSessionConfig + getSessionConfig round-trip", () => {
	setSessionConfig("s1", ALTERNATE);
	assert.deepEqual(getSessionConfig("s1"), ALTERNATE);
	clearSessionSpinnerOptions("s1");
});

test("spinner-state: getSessionConfig for unknown session returns defaults", () => {
	assert.deepEqual(
		getSessionConfig("never-set"),
		DEFAULT_MINIMAL_TOOLCALL_CONFIG,
	);
});

test("spinner-state: getSessionConfig(undefined) returns defaults (no throw)", () => {
	assert.deepEqual(getSessionConfig(undefined), DEFAULT_MINIMAL_TOOLCALL_CONFIG);
});

test("spinner-state: getSessionSpinnerOptions derives frames + intervalMs from the session config", () => {
	setSessionConfig("s2", ALTERNATE);
	assert.deepEqual(getSessionConfig("s2"), ALTERNATE);
	assert.equal(getSessionSpinnerOptions("s2").intervalMs, 200);
	assert.deepEqual(getSessionSpinnerOptions("s2").frames, ["a", "b", "c"]);
	clearSessionSpinnerOptions("s2");
});

test("spinner-state: getSessionSpinnerOptions for unknown session uses defaults", () => {
	const opts = getSessionSpinnerOptions("missing");
	assert.equal(opts.intervalMs, DEFAULT_MINIMAL_TOOLCALL_CONFIG.spinnerIntervalMs);
	assert.deepEqual(opts.frames, DEFAULT_MINIMAL_TOOLCALL_CONFIG.spinnerFrames);
});

test("spinner-state: registerToolCallSession + getSessionIdForToolCall round-trip", () => {
	registerToolCallSession("call-A", "s3");
	assert.equal(getSessionIdForToolCall("call-A"), "s3");
	// Unrelated session ids are not affected
	assert.equal(getSessionIdForToolCall("call-B"), undefined);
	clearSessionSpinnerOptions("s3");
});

test("spinner-state: unregisterToolCallSession removes the mapping", () => {
	registerToolCallSession("call-C", "s4");
	unregisterToolCallSession("call-C");
	assert.equal(getSessionIdForToolCall("call-C"), undefined);
	clearSessionSpinnerOptions("s4");
});

test("spinner-state: clearSessionSpinnerOptions removes the session and its tool-call mappings", () => {
	setSessionConfig("s5", ALTERNATE);
	registerToolCallSession("call-D", "s5");
	registerToolCallSession("call-E", "s5");
	registerToolCallSession("call-F", "s6");
	clearSessionSpinnerOptions("s5");
	assert.equal(getSessionConfig("s5"), DEFAULT_MINIMAL_TOOLCALL_CONFIG);
	assert.equal(getSessionIdForToolCall("call-D"), undefined);
	assert.equal(getSessionIdForToolCall("call-E"), undefined);
	// Other session's mapping is untouched
	assert.equal(getSessionIdForToolCall("call-F"), "s6");
	clearSessionSpinnerOptions("s6");
});

test("spinner-state: clearSessionSpinnerOptions is a no-op for unknown sessions", () => {
	clearSessionSpinnerOptions("never-existed");
	assert.deepEqual(
		getSessionConfig("never-existed"),
		DEFAULT_MINIMAL_TOOLCALL_CONFIG,
	);
});
