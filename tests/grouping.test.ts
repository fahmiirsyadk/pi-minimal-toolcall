import assert from "node:assert/strict";
import test from "node:test";
import { createGroupingSession } from "../src/grouping.ts";
import { passThroughTheme } from "./helpers.ts";

function startCall(
	g: ReturnType<typeof createGroupingSession>,
	id: string,
	tool: string,
	args: unknown = {},
) {
	g.onToolExecutionStart({ toolCallId: id, toolName: tool, args });
}

test("consecutive same-tool calls accumulate into one group", () => {
	const g = createGroupingSession();
	startCall(g, "r1", "read", { path: "/p/a" });
	startCall(g, "r2", "read", { path: "/p/b" });
	const group = g.getCurrentGroup("r2");
	assert.equal(group?.entries.length, 2);
	assert.equal(group?.toolName, "read");
});

test("different tool cuts the group and starts a new one", () => {
	const g = createGroupingSession();
	startCall(g, "r1", "read");
	startCall(g, "r2", "read");
	startCall(g, "b1", "bash");
	startCall(g, "r3", "read");
	// Three groups: read(2), bash(1), read(1)
	const readGroup1 = g.getCurrentGroup("r2");
	const bashGroup = g.getCurrentGroup("b1");
	const readGroup2 = g.getCurrentGroup("r3");
	assert.equal(readGroup1?.entries.length, 2);
	assert.equal(bashGroup?.entries.length, 1);
	assert.equal(readGroup2?.entries.length, 1);
	assert.notEqual(readGroup1, readGroup2);
});

test("isGroupLatest: true for last entry, false for earlier in same group", () => {
	const g = createGroupingSession();
	startCall(g, "r1", "read");
	startCall(g, "r2", "read");
	assert.equal(g.isGroupLatest("r1"), false);
	assert.equal(g.isGroupLatest("r2"), true);
});

test("isGroupLatest: a frozen group's last entry is still its latest", () => {
	const g = createGroupingSession();
	startCall(g, "r1", "read");
	startCall(g, "r2", "read");
	startCall(g, "b1", "bash"); // freezes the read group
	// r2 is still the latest in ITS group (the read group), even though
	// the currently-active group is now bash.
	assert.equal(g.isGroupLatest("r2"), true);
	assert.equal(g.isGroupLatest("r1"), false);
	assert.equal(g.isGroupLatest("b1"), true);
});

test("storeResult: stores output, isError, and diffSuffix on the entry", () => {
	const g = createGroupingSession();
	startCall(g, "r1", "read", { path: "/p/a" });
	g.storeResult(
		"r1",
		{ content: [{ type: "text", text: "file content" }] },
		false,
		" +5",
	);
	const group = g.getCurrentGroup("r1");
	const entry = group?.entries[0];
	assert.equal(entry?.output, "file content");
	assert.equal(entry?.isError, false);
	assert.equal(entry?.diffSuffix, " +5");
});

test("storeResult: unknown toolCallId → no-op", () => {
	const g = createGroupingSession();
	g.storeResult("nonexistent", { content: [] }, false);
	// Should not throw
	assert.equal(g.getCurrentGroup(), null);
});

test("renderGroupSummary: count + noun + arg + expand hint", () => {
	const g = createGroupingSession();
	startCall(g, "r1", "read", { path: "/p/a" });
	startCall(g, "r2", "read", { path: "/p/b" });
	const group = g.getCurrentGroup("r2")!;
	const summary = g.renderGroupSummary(group, passThroughTheme, "/p");
	// Strip ANSI from keyHint, check the plain-text parts
	assert.match(summary, /Read 2 files/);
	assert.match(summary, /\(b\)/);
	assert.match(summary, /to expand/);
});

test("renderGroupSummary: error mark ✗ when isError", () => {
	const g = createGroupingSession();
	startCall(g, "r1", "read", { path: "/p/missing" });
	const group = g.getCurrentGroup("r1")!;
	const summary = g.renderGroupSummary(
		group,
		passThroughTheme,
		"/p",
		undefined,
		true,
	);
	assert.ok(summary.includes("✗"), `expected ✗ in: ${JSON.stringify(summary)}`);
});

test("renderGroupSummary: no error mark when isError is false/omitted", () => {
	const g = createGroupingSession();
	startCall(g, "r1", "read", { path: "/p/a" });
	const group = g.getCurrentGroup("r1")!;
	const summary = g.renderGroupSummary(group, passThroughTheme, "/p");
	assert.ok(
		!summary.includes("✗"),
		`expected no ✗ in: ${JSON.stringify(summary)}`,
	);
});

test("duplicate onToolExecutionStart for same toolCallId → idempotent", () => {
	const g = createGroupingSession();
	startCall(g, "r1", "read", { path: "/p/a" });
	startCall(g, "r1", "read", { path: "/p/a" }); // duplicate
	const group = g.getCurrentGroup("r1");
	assert.equal(group?.entries.length, 1);
});

test("registerInvalidate: stores the invalidate hook on the entry", () => {
	const g = createGroupingSession();
	startCall(g, "r1", "read");
	let called = false;
	g.registerInvalidate("r1", () => {
		called = true;
	});
	const group = g.getCurrentGroup("r1");
	const entry = group?.entries[0];
	entry?.invalidate?.();
	assert.equal(called, true);
});

test("onToolExecutionStart invalidates the previous entry in the same group", () => {
	const g = createGroupingSession();
	let invalidated = false;
	startCall(g, "r1", "read");
	g.registerInvalidate("r1", () => {
		invalidated = true;
	});
	startCall(g, "r2", "read"); // should invalidate r1
	assert.equal(invalidated, true);
});

test("onToolExecutionStart does NOT invalidate when a different tool starts", () => {
	const g = createGroupingSession();
	let invalidated = false;
	startCall(g, "r1", "read");
	g.registerInvalidate("r1", () => {
		invalidated = true;
	});
	startCall(g, "b1", "bash"); // should NOT invalidate r1 (different group)
	assert.equal(invalidated, false);
});
