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
	assert.equal(group?.entries[0]?.toolName, "read");
});

test("mixed tools with nothing between them stay in one group", () => {
	const g = createGroupingSession();
	startCall(g, "r1", "read");
	startCall(g, "r2", "read");
	startCall(g, "b1", "bash");
	startCall(g, "r3", "read");
	// Proximity grouping: all four calls are in ONE group (no
	// text/thinking froze between them), regardless of tool name.
	const group = g.getCurrentGroup("r3");
	assert.equal(group?.entries.length, 4);
	assert.equal(group?.entries[2]?.toolName, "bash");
});

test("freezeCurrentGroup: next call (same or different tool) starts a fresh group", () => {
	const g = createGroupingSession();
	startCall(g, "r1", "read");
	startCall(g, "r2", "read");
	g.freezeCurrentGroup(); // simulates a text/thinking block appearing
	startCall(g, "r3", "read");
	startCall(g, "b1", "bash");
	const prevGroup = g.getCurrentGroup("r2");
	const newGroup = g.getCurrentGroup("r3");
	assert.notEqual(prevGroup, newGroup);
	assert.equal(prevGroup?.entries.length, 2);
	assert.equal(newGroup?.entries.length, 2);
	assert.equal(g.isGroupLatest("r2"), true);
	assert.equal(g.isGroupLatest("r3"), false);
	assert.equal(g.isGroupLatest("b1"), true);
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
	g.freezeCurrentGroup(); // freezes the read group (simulates thinking)
	startCall(g, "b1", "bash");
	// r2 is still the latest in ITS group (the read group), even though
	// the currently-active group is now bash.
	assert.equal(g.isGroupLatest("r2"), true);
	assert.equal(g.isGroupLatest("r1"), false);
	assert.equal(g.isGroupLatest("b1"), true);
});

test("storeResult: stores output, isError, and diffInfo on the entry", () => {
	const g = createGroupingSession();
	startCall(g, "r1", "read", { path: "/p/a" });
	g.storeResult(
		"r1",
		{ content: [{ type: "text", text: "file content" }] },
		false,
		{ added: 5, removed: 0 },
	);
	const group = g.getCurrentGroup("r1");
	const entry = group?.entries[0];
	assert.equal(entry?.output, "file content");
	assert.equal(entry?.isError, false);
	assert.deepEqual(entry?.diffInfo, { added: 5, removed: 0 });
});

test("storeResult: unknown toolCallId → no-op", () => {
	const g = createGroupingSession();
	g.storeResult("nonexistent", { content: [] }, false);
	// Should not throw
	assert.equal(g.getCurrentGroup(), null);
});

test("renderGroupSummary: count + noun + arg + expand hint (single-tool)", () => {
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

test("renderGroupSummary: multi-tool group joins tools with & and drops args", () => {
	const g = createGroupingSession();
	startCall(g, "r1", "read", { path: "/p/a" });
	startCall(g, "r2", "read", { path: "/p/b" });
	startCall(g, "b1", "bash", { command: "ls" });
	const group = g.getCurrentGroup("b1")!;
	const summary = g.renderGroupSummary(group, passThroughTheme, "/p");
	assert.match(summary, /Read 2 files/);
	assert.match(summary, /Shell 1 command/);
	assert.ok(summary.includes("&"), `expected & separator in: ${summary}`);
	// Multi-tool line shows no per-tool arg.
	assert.ok(!summary.includes("(b)"), `expected no arg in: ${summary}`);
	assert.ok(!summary.includes("(ls)"), `expected no arg in: ${summary}`);
});

test("renderGroupSummary: multi-tool group aggregates diffs across edit/write", () => {
	const g = createGroupingSession();
	startCall(g, "r1", "read", { path: "/p/a" });
	startCall(g, "e1", "edit", { path: "/p/a" });
	startCall(g, "e2", "edit", { path: "/p/b" });
	g.storeResult("r1", { content: [{ type: "text", text: "x" }] }, false);
	g.storeResult("e1", { content: [{ type: "text", text: "ok" }] }, false, {
		added: 5,
		removed: 2,
	});
	g.storeResult("e2", { content: [{ type: "text", text: "ok" }] }, false, {
		added: 15,
		removed: 8,
	});
	const group = g.getCurrentGroup("e2")!;
	const summary = g.renderGroupSummary(group, passThroughTheme, "/p");
	// Aggregated: 5+15=20 added, 2+8=10 removed.
	assert.match(summary, /\+20/);
	assert.match(summary, /-10/);
});

test("renderGroupSummary: per-tool ✗ when any entry of that tool errored", () => {
	const g = createGroupingSession();
	startCall(g, "r1", "read", { path: "/p/a" });
	startCall(g, "b1", "bash", { command: "fail" });
	g.storeResult("r1", { content: [{ type: "text", text: "ok" }] }, false);
	g.storeResult("b1", { content: [{ type: "text", text: "boom" }] }, true);
	const group = g.getCurrentGroup("b1")!;
	const summary = g.renderGroupSummary(group, passThroughTheme, "/p");
	assert.match(summary, /Read 1 file/);
	assert.match(summary, /Shell 1 command ✗/);
});

test("renderGroupSummary: error mark ✗ when an entry is errored", () => {
	const g = createGroupingSession();
	startCall(g, "r1", "read", { path: "/p/missing" });
	// The error mark is derived from stored results, so store one.
	g.storeResult("r1", { content: [{ type: "text", text: "x" }] }, true);
	const group = g.getCurrentGroup("r1")!;
	const summary = g.renderGroupSummary(group, passThroughTheme, "/p");
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

test("onToolExecutionStart invalidates the previous entry when a different tool joins the same group", () => {
	const g = createGroupingSession();
	let invalidated = false;
	startCall(g, "r1", "read");
	g.registerInvalidate("r1", () => {
		invalidated = true;
	});
	// Proximity grouping: bash joins the read group (no text/thinking
	// between), so r1 is invalidated and collapses.
	startCall(g, "b1", "bash");
	assert.equal(invalidated, true);
});

test("onToolExecutionStart does NOT invalidate a frozen group's entry", () => {
	const g = createGroupingSession();
	let invalidated = false;
	startCall(g, "r1", "read");
	g.registerInvalidate("r1", () => {
		invalidated = true;
	});
	g.freezeCurrentGroup(); // text/thinking froze the read group
	startCall(g, "b1", "bash"); // starts a NEW group
	assert.equal(invalidated, false);
});

test("freezeCurrentGroup: next same-tool call starts a fresh group", () => {
	const g = createGroupingSession();
	startCall(g, "s8", "bash", { command: "echo 8" });
	// Simulate the user submitting a new prompt: agent_start freezes.
	g.freezeCurrentGroup();
	startCall(g, "s9", "bash", { command: "echo 9" });
	const prevGroup = g.getCurrentGroup("s8");
	const newGroup = g.getCurrentGroup("s9");
	assert.notEqual(prevGroup, newGroup);
	assert.equal(prevGroup?.entries.length, 1);
	assert.equal(newGroup?.entries.length, 1);
	assert.equal(g.isGroupLatest("s8"), true);
	assert.equal(g.isGroupLatest("s9"), true);
});

test("freezeCurrentGroup: no-op when there is no current group", () => {
	const g = createGroupingSession();
	g.freezeCurrentGroup();
	assert.equal(g.getCurrentGroup(), null);
});

// --- GroupingOptions: splitOnDifferentTool -------------------------------

test("createGroupingSession({ splitOnDifferentTool: true }): 'consecutive' — read, read, bash, read → 3 groups", () => {
	const g = createGroupingSession({ splitOnDifferentTool: true });
	startCall(g, "r1", "read");
	startCall(g, "r2", "read");
	startCall(g, "b1", "bash");
	startCall(g, "r3", "read");
	const readGroup1 = g.getCurrentGroup("r2");
	const bashGroup = g.getCurrentGroup("b1");
	const readGroup2 = g.getCurrentGroup("r3");
	assert.equal(readGroup1?.entries.length, 2);
	assert.equal(bashGroup?.entries.length, 1);
	assert.equal(readGroup2?.entries.length, 1);
	assert.notEqual(readGroup1, readGroup2);
	assert.notEqual(bashGroup, readGroup1);
	assert.notEqual(bashGroup, readGroup2);
});

test("createGroupingSession({ splitOnDifferentTool: true }): bash's group is 1 entry; r3 starts a new group", () => {
	const g = createGroupingSession({ splitOnDifferentTool: true });
	startCall(g, "r1", "read");
	startCall(g, "r2", "read");
	startCall(g, "b1", "bash");
	startCall(g, "r3", "read");
	assert.equal(g.isGroupLatest("r2"), true);
	assert.equal(g.isGroupLatest("b1"), true);
	assert.equal(g.isGroupLatest("r3"), true);
	assert.equal(g.isGroupLatest("r1"), false);
});

test("createGroupingSession({ splitOnDifferentTool: false }) (default): read, read, bash, read → 1 group of 4", () => {
	const g = createGroupingSession({ splitOnDifferentTool: false });
	startCall(g, "r1", "read");
	startCall(g, "r2", "read");
	startCall(g, "b1", "bash");
	startCall(g, "r3", "read");
	const finalGroup = g.getCurrentGroup("r3");
	assert.equal(finalGroup?.entries.length, 4);
	assert.equal(g.isGroupLatest("r3"), true);
	assert.equal(g.isGroupLatest("r1"), false);
	assert.equal(g.isGroupLatest("b1"), false);
});

// --- renderGroupSummary: showErrorMark + showDiffSuffix --------------------

test("renderGroupSummary: showErrorMark=false → no ✗ even when an entry errored", () => {
	const g = createGroupingSession();
	startCall(g, "r1", "read", { path: "/p/x" });
	g.storeResult("r1", { content: [{ type: "text", text: "x" }] }, true);
	const group = g.getCurrentGroup("r1")!;
	const summary = g.renderGroupSummary(group, passThroughTheme, "/p", {
		showErrorMark: false,
	});
	assert.ok(
		!summary.includes("✗"),
		`expected no ✗ in: ${JSON.stringify(summary)}`,
	);
});

test("renderGroupSummary: showDiffSuffix=false → no +N -M even when entries have diffs", () => {
	const g = createGroupingSession();
	startCall(g, "e1", "edit", { path: "/p/x" });
	g.storeResult("e1", { content: [{ type: "text", text: "ok" }] }, false, {
		added: 5,
		removed: 2,
	});
	const group = g.getCurrentGroup("e1")!;
	const summary = g.renderGroupSummary(group, passThroughTheme, "/p", {
		showDiffSuffix: false,
	});
	assert.ok(
		!summary.includes("+5"),
		`expected no +5 in: ${JSON.stringify(summary)}`,
	);
	assert.ok(
		!summary.includes("-2"),
		`expected no -2 in: ${JSON.stringify(summary)}`,
	);
});
