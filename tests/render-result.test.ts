import assert from "node:assert/strict";
import test, { after } from "node:test";
import { Container, Text } from "@earendil-works/pi-tui";
import { createGroupingSession } from "../src/grouping.ts";
import {
	clearAllSpinners,
	formatDuration,
	overrideEdit,
	overrideRead,
	overrideWrite,
} from "../src/tool-overrides.ts";
import {
	makeContext,
	passThroughTheme,
	renderedLineCount,
	renderedText,
} from "./helpers.ts";

after(() => clearAllSpinners());

const CWD = "/home/user/project";

function startCall(
	g: ReturnType<typeof createGroupingSession>,
	id: string,
	tool: string,
	args: unknown = {},
) {
	g.onToolExecutionStart({ toolCallId: id, toolName: tool, args });
}

function makeResult(text: string, details: unknown = undefined): any {
	return {
		content: [{ type: "text" as const, text }],
		details,
	};
}

// ─── Collapsed summary ───────────────────────────────────────────────────────

test("renderResult: collapsed summary shows count + latest arg", () => {
	const g = createGroupingSession();
	const def = overrideRead(g);
	startCall(g, "r1", "read", { path: `${CWD}/a.ts` });
	startCall(g, "r2", "read", { path: `${CWD}/b.ts` });
	// Store r1's result first (it ran first)
	const ctx1 = makeContext({ toolCallId: "r1", cwd: CWD, state: {} });
	def.renderResult!(
		makeResult("content of a"),
		{ expanded: false, isPartial: false },
		passThroughTheme,
		ctx1,
	);
	// r2's result: this is the latest, so it renders the summary
	const ctx2 = makeContext({ toolCallId: "r2", cwd: CWD, state: {} });
	const comp = def.renderResult!(
		makeResult("content of b"),
		{ expanded: false, isPartial: false },
		passThroughTheme,
		ctx2,
	);
	const text = renderedText(comp);
	assert.match(text, /Read 2 files/);
	assert.match(text, /b\.ts/);
});

test("renderResult: collapsed summary shows ✗ on error", () => {
	const g = createGroupingSession();
	const def = overrideRead(g);
	startCall(g, "r1", "read", { path: `${CWD}/missing.ts` });
	const ctx = makeContext({
		toolCallId: "r1",
		cwd: CWD,
		isError: true,
		state: {},
	});
	const comp = def.renderResult!(
		makeResult("File not found"),
		{ expanded: false, isPartial: false },
		passThroughTheme,
		ctx,
	);
	assert.ok(renderedText(comp).includes("✗"));
});

test("renderResult: non-latest entry collapses to 0-line when collapsed", () => {
	const g = createGroupingSession();
	const def = overrideRead(g);
	startCall(g, "r1", "read", { path: `${CWD}/a.ts` });
	startCall(g, "r2", "read", { path: `${CWD}/b.ts` });
	// r1 is non-latest; its result should collapse to 0-line
	const ctx1 = makeContext({ toolCallId: "r1", cwd: CWD, state: {} });
	const comp = def.renderResult!(
		makeResult("content of a"),
		{ expanded: false, isPartial: false },
		passThroughTheme,
		ctx1,
	);
	assert.equal(renderedLineCount(comp), 0);
});

// ─── Expanded view: cache fix (Bug #12) ──────────────────────────────────────

test("renderResult: collapsed returns Text, expanded returns Container (no throw)", () => {
	const g = createGroupingSession();
	const def = overrideRead(g);
	startCall(g, "r1", "read", { path: `${CWD}/a.ts` });
	const state: Record<string, unknown> = {};
	// First: collapsed
	const ctxCollapsed = makeContext({ toolCallId: "r1", cwd: CWD, state });
	const collapsed = def.renderResult!(
		makeResult("line1\nline2"),
		{ expanded: false, isPartial: false },
		passThroughTheme,
		ctxCollapsed,
	);
	assert.ok(collapsed instanceof Text, "collapsed should be a Text");
	// Then: expanded with the SAME state (simulates toggle)
	const ctxExpanded = makeContext({ toolCallId: "r1", cwd: CWD, state });
	const expanded = def.renderResult!(
		makeResult("line1\nline2"),
		{ expanded: true, isPartial: false },
		passThroughTheme,
		ctxExpanded,
	);
	assert.ok(expanded instanceof Container, "expanded should be a Container");
	// Should not throw when rendering the Container
	assert.doesNotThrow(() => renderedText(expanded));
});

test("renderResult: toggle expanded → collapsed → expanded works without error", () => {
	const g = createGroupingSession();
	const def = overrideRead(g);
	startCall(g, "r1", "read", { path: `${CWD}/a.ts` });
	const state: Record<string, unknown> = {};
	// expanded
	def.renderResult!(
		makeResult("x"),
		{ expanded: true, isPartial: false },
		passThroughTheme,
		makeContext({ toolCallId: "r1", cwd: CWD, state }),
	);
	// collapsed
	const c2 = def.renderResult!(
		makeResult("x"),
		{ expanded: false, isPartial: false },
		passThroughTheme,
		makeContext({ toolCallId: "r1", cwd: CWD, state }),
	);
	assert.ok(c2 instanceof Text);
	// expanded again
	const c3 = def.renderResult!(
		makeResult("x"),
		{ expanded: true, isPartial: false },
		passThroughTheme,
		makeContext({ toolCallId: "r1", cwd: CWD, state }),
	);
	assert.ok(c3 instanceof Container);
	assert.doesNotThrow(() => renderedText(c3));
});

// ─── Expanded view: shows all entries in the group ───────────────────────────

test("renderResult: expanded shows every entry's output, not just the latest", () => {
	const g = createGroupingSession();
	const def = overrideRead(g);
	startCall(g, "r1", "read", { path: `${CWD}/a.ts` });
	startCall(g, "r2", "read", { path: `${CWD}/b.ts` });
	// Store r1's result
	def.renderResult!(
		makeResult("content of A"),
		{ expanded: false, isPartial: false },
		passThroughTheme,
		makeContext({ toolCallId: "r1", cwd: CWD, state: {} }),
	);
	// Expand r2 (the latest): should show BOTH entries
	const ctx2 = makeContext({ toolCallId: "r2", cwd: CWD, state: {} });
	const comp = def.renderResult!(
		makeResult("content of B"),
		{ expanded: true, isPartial: false },
		passThroughTheme,
		ctx2,
	);
	const text = renderedText(comp);
	assert.ok(text.includes("content of A"), `expected output of A in:\n${text}`);
	assert.ok(text.includes("content of B"), `expected output of B in:\n${text}`);
	assert.ok(text.includes("a.ts"), `expected arg a.ts in:\n${text}`);
	assert.ok(text.includes("b.ts"), `expected arg b.ts in:\n${text}`);
	assert.match(text, /2 calls in this group/);
});

test("renderResult: expanded shows ✓/✗ per entry", () => {
	const g = createGroupingSession();
	const def = overrideRead(g);
	startCall(g, "r1", "read", { path: `${CWD}/a.ts` });
	// Store r1 as error
	def.renderResult!(
		makeResult("not found"),
		{ expanded: false, isPartial: false },
		passThroughTheme,
		makeContext({ toolCallId: "r1", cwd: CWD, isError: true, state: {} }),
	);
	// Expand: should show ✗ for r1
	const comp = def.renderResult!(
		makeResult("ok"),
		{ expanded: true, isPartial: false },
		passThroughTheme,
		makeContext({ toolCallId: "r1", cwd: CWD, isError: true, state: {} }),
	);
	const text = renderedText(comp);
	assert.ok(text.includes("✗"), `expected ✗ for error entry in:\n${text}`);
});

// ─── Expanded view: tail cap ─────────────────────────────────────────────────

test("renderResult: expanded body is tail-capped at 200 lines", () => {
	const g = createGroupingSession();
	const def = overrideRead(g);
	startCall(g, "r1", "read", { path: `${CWD}/big.ts` });
	// 300 lines of output
	const output = Array.from({ length: 300 }, (_, i) => `line${i}`).join("\n");
	const comp = def.renderResult!(
		makeResult(output),
		{ expanded: true, isPartial: false },
		passThroughTheme,
		makeContext({ toolCallId: "r1", cwd: CWD, state: {} }),
	);
	const text = renderedText(comp);
	// The tail should show the LAST lines, not the first
	assert.ok(
		text.includes("line299"),
		`expected tail to include line299 in:\n${text.slice(-200)}`,
	);
	assert.ok(!text.includes("line0"), `expected head line0 to be truncated`);
	assert.match(text, /earlier lines not shown/);
});

// ─── Partial streaming ───────────────────────────────────────────────────────

test("renderResult: partial returns 0-line Text and does not clear spinner", () => {
	const g = createGroupingSession();
	const def = overrideRead(g);
	startCall(g, "r1", "read", { path: `${CWD}/a.ts` });
	const state: Record<string, unknown> = {};
	// First call: renderCall to start the spinner
	def.renderCall!(
		{ path: `${CWD}/a.ts` },
		passThroughTheme,
		makeContext({
			toolCallId: "r1",
			cwd: CWD,
			executionStarted: true,
			isPartial: true,
			state,
		}),
	);
	// Partial result: should return 0-line and keep spinner alive
	const comp = def.renderResult!(
		makeResult("partial"),
		{ expanded: false, isPartial: true },
		passThroughTheme,
		makeContext({ toolCallId: "r1", cwd: CWD, isPartial: true, state }),
	);
	assert.equal(renderedLineCount(comp), 0);
	// The call text should still have content (spinner still alive)
	const callText = state["__piMinimalToolcallCallText"] as Text;
	const callRendered = renderedText(callText);
	assert.match(
		callRendered,
		/⠋/,
		"spinner should still be alive during partial",
	);
});

// ─── Write diff: capture-once ────────────────────────────────────────────────

test("renderResult: write shows +N -M diff for existing file", () => {
	const g = createGroupingSession();
	const def = overrideWrite(g);
	const writeArgs = { path: `${CWD}/new.ts`, content: "a\nb\nc" };
	startCall(g, "w1", "write", writeArgs);
	const state: Record<string, unknown> = {};
	// renderCall captures the write meta (file doesn't exist → +N -0)
	def.renderCall!(
		writeArgs,
		passThroughTheme,
		makeContext({ toolCallId: "w1", cwd: CWD, state, args: writeArgs }),
	);
	const comp = def.renderResult!(
		makeResult("wrote"),
		{ expanded: false, isPartial: false },
		passThroughTheme,
		makeContext({ toolCallId: "w1", cwd: CWD, state, args: writeArgs }),
	);
	const text = renderedText(comp);
	assert.match(text, /\+3/);
});

test("renderResult: write diff meta is captured once (not re-captured post-write)", () => {
	const g = createGroupingSession();
	const def = overrideWrite(g);
	const writeArgs = { path: `${CWD}/file.ts`, content: "new" };
	startCall(g, "w1", "write", writeArgs);
	const state: Record<string, unknown> = {};
	// First renderCall: captures meta (file doesn't exist → +1 -0)
	def.renderCall!(
		writeArgs,
		passThroughTheme,
		makeContext({ toolCallId: "w1", cwd: CWD, state, args: writeArgs }),
	);
	// Second renderCall (simulating spinner tick): should NOT re-capture
	// If it did, and the file was written between calls, it would read the
	// post-write content and produce +1 -1 instead of +1 -0.
	def.renderCall!(
		writeArgs,
		passThroughTheme,
		makeContext({ toolCallId: "w1", cwd: CWD, state, args: writeArgs }),
	);
	const comp = def.renderResult!(
		makeResult("wrote"),
		{ expanded: false, isPartial: false },
		passThroughTheme,
		makeContext({ toolCallId: "w1", cwd: CWD, state, args: writeArgs }),
	);
	const text = renderedText(comp);
	assert.match(text, /\+1/);
	// Should NOT show -1 (file didn't exist before)
	assert.ok(
		!text.includes("-1"),
		`expected no removals for new file in: ${text}`,
	);
});

// ─── Edit diff ───────────────────────────────────────────────────────────────

test("renderResult: edit shows +N -M from patch", () => {
	const g = createGroupingSession();
	const def = overrideEdit(g);
	startCall(g, "e1", "edit", {
		path: `${CWD}/file.ts`,
		oldText: "old",
		newText: "new\nline2",
	});
	const patch = "--- a/file\n+++ b/file\n@@ -1,1 +1,2 @@\n-old\n+new\n+line2\n";
	const comp = def.renderResult!(
		makeResult("edited", { patch }),
		{ expanded: false, isPartial: false },
		passThroughTheme,
		makeContext({ toolCallId: "e1", cwd: CWD, state: {} }),
	);
	const text = renderedText(comp);
	assert.match(text, /\+2/);
	assert.match(text, /-1/);
});

// ─── Earlier entry expanded preservation ─────────────────────────────────────

test("renderResult: earlier entry expanded is preserved if it was cached", () => {
	const g = createGroupingSession();
	const def = overrideRead(g);
	startCall(g, "r1", "read", { path: `${CWD}/a.ts` });
	const state: Record<string, unknown> = {};
	// Expand r1 while it's the latest
	const expanded = def.renderResult!(
		makeResult("content of A"),
		{ expanded: true, isPartial: false },
		passThroughTheme,
		makeContext({ toolCallId: "r1", cwd: CWD, state }),
	);
	assert.ok(expanded instanceof Container);
	// Now a new same-tool call lands
	startCall(g, "r2", "read", { path: `${CWD}/b.ts` });
	// r1 is now non-latest; re-render with expanded=true
	// Should return the preserved Container (not 0-line)
	const comp = def.renderResult!(
		makeResult("content of A"),
		{ expanded: true, isPartial: false },
		passThroughTheme,
		makeContext({ toolCallId: "r1", cwd: CWD, state }),
	);
	const text = renderedText(comp);
	// Should still show the earlier entry's content
	assert.ok(
		text.includes("content of A"),
		`expected preserved content in:\n${text}`,
	);
	assert.match(text, /earlier in group/);
});

test("renderResult: earlier entry expanded without cache → 0-line", () => {
	const g = createGroupingSession();
	const def = overrideRead(g);
	startCall(g, "r1", "read", { path: `${CWD}/a.ts` });
	startCall(g, "r2", "read", { path: `${CWD}/b.ts` });
	// r1 was never expanded (no cached Container). Even if options.expanded=true,
	// it should return 0-line (no cached Container to preserve).
	const comp = def.renderResult!(
		makeResult("content of A"),
		{ expanded: true, isPartial: false },
		passThroughTheme,
		makeContext({ toolCallId: "r1", cwd: CWD, state: {} }),
	);
	assert.equal(renderedLineCount(comp), 0);
});

// ─── Timing ──────────────────────────────────────────────────────────────────

test("formatDuration: < 1s → ms", () => {
	assert.equal(formatDuration(500), "500ms");
	assert.equal(formatDuration(0), "0ms");
});

test("formatDuration: ≥ 1s → seconds with 1 decimal", () => {
	assert.equal(formatDuration(1000), "1.0s");
	assert.equal(formatDuration(1500), "1.5s");
	assert.equal(formatDuration(42000), "42.0s");
});

test("formatDuration: undefined → empty string", () => {
	assert.equal(formatDuration(undefined), "");
});

test("renderResult: expanded header shows duration", () => {
	const g = createGroupingSession();
	const def = overrideRead(g);
	startCall(g, "r1", "read", { path: `${CWD}/a.ts` });
	// Small delay so duration > 0
	const comp = def.renderResult!(
		makeResult("content"),
		{ expanded: true, isPartial: false },
		passThroughTheme,
		makeContext({ toolCallId: "r1", cwd: CWD, state: {} }),
	);
	const text = renderedText(comp);
	// The duration should appear in the header (formatDuration produces
	// either Xms or X.Xs)
	assert.match(text, /\d+(ms|\.\ds)/);
});

// ─── Edit diff in expand ─────────────────────────────────────────────────────

test("renderResult: expanded edit shows the full diff patch, not just 'Successfully replaced'", () => {
	const g = createGroupingSession();
	const def = overrideEdit(g);
	startCall(g, "e1", "edit", {
		path: `${CWD}/file.ts`,
		oldText: "old",
		newText: "new",
	});
	const patch = "--- a/file\n+++ b/file\n@@ -1,1 +1,1 @@\n-old\n+new\n";
	const comp = def.renderResult!(
		makeResult("Successfully replaced 1 block(s) in file.ts.", { patch }),
		{ expanded: true, isPartial: false },
		passThroughTheme,
		makeContext({ toolCallId: "e1", cwd: CWD, state: {} }),
	);
	const text = renderedText(comp);
	// The text output "Successfully replaced..." should be there
	assert.ok(
		text.includes("Successfully replaced"),
		`expected success message in:\n${text}`,
	);
	// The actual diff lines from details.patch should also be there
	assert.ok(text.includes("-old"), `expected diff -old line in:\n${text}`);
	assert.ok(text.includes("+new"), `expected diff +new line in:\n${text}`);
	assert.ok(
		text.includes("@@ -1,1 +1,1 @@"),
		`expected hunk header in:\n${text}`,
	);
});
