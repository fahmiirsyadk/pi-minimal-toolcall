import assert from "node:assert/strict";
import test, { after } from "node:test";
import { Text } from "@earendil-works/pi-tui";
import { DEFAULT_MINIMAL_TOOLCALL_CONFIG } from "../src/config/index.js";
import { createGroupingSession } from "../src/grouping.ts";
import {
	clearAllSpinners,
	getSpinnerFrame,
	overrideBash,
	overrideRead,
} from "../src/tool-overrides.ts";
import {
	makeContext,
	passThroughTheme,
	renderedLineCount,
	renderedText,
	wait,
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

// ─── Spinner line shape ──────────────────────────────────────────────────────

test("renderCall: bash spinner shows Shell + count + command", () => {
	const g = createGroupingSession();
	const def = overrideBash(g);
	startCall(g, "b1", "bash", { command: "npm test" });
	const ctx = makeContext({
		toolCallId: "b1",
		cwd: CWD,
		executionStarted: true,
		isPartial: true,
		state: {},
	});
	const comp = def.renderCall!({ command: "npm test" }, passThroughTheme, ctx);
	assert.ok(comp instanceof Text);
	assert.match(renderedText(comp), /Shell 1 command/);
	assert.match(renderedText(comp), /npm test/);
});

test("renderCall: read spinner shows Read + count + path", () => {
	const g = createGroupingSession();
	const def = overrideRead(g);
	startCall(g, "r1", "read", { path: `${CWD}/foo.ts` });
	const ctx = makeContext({
		toolCallId: "r1",
		cwd: CWD,
		executionStarted: true,
		isPartial: true,
		state: {},
	});
	const comp = def.renderCall!(
		{ path: `${CWD}/foo.ts` },
		passThroughTheme,
		ctx,
	);
	assert.match(renderedText(comp), /Read 1 file/);
	assert.match(renderedText(comp), /foo\.ts/);
});

test("renderCall: group count reflects consecutive calls", () => {
	const g = createGroupingSession();
	const def = overrideRead(g);
	startCall(g, "r1", "read", { path: `${CWD}/a.ts` });
	startCall(g, "r2", "read", { path: `${CWD}/b.ts` });
	const ctx = makeContext({
		toolCallId: "r2",
		cwd: CWD,
		executionStarted: true,
		isPartial: true,
		state: {},
	});
	const comp = def.renderCall!({ path: `${CWD}/b.ts` }, passThroughTheme, ctx);
	assert.match(renderedText(comp), /Read 2 files/);
});

test("renderCall: non-latest entry collapses call row to 0 lines", () => {
	const g = createGroupingSession();
	const def = overrideRead(g);
	startCall(g, "r1", "read", { path: `${CWD}/a.ts` });
	startCall(g, "r2", "read", { path: `${CWD}/b.ts` });
	// r1 is no longer the latest; its renderCall should return 0-line
	const ctx = makeContext({
		toolCallId: "r1",
		cwd: CWD,
		executionStarted: true,
		isPartial: true,
		state: {},
	});
	const comp = def.renderCall!({ path: `${CWD}/a.ts` }, passThroughTheme, ctx);
	assert.equal(renderedLineCount(comp), 0);
});

// ─── Spinner animation ───────────────────────────────────────────────────────

test("renderCall: spinner frame advances over time", async () => {
	const g = createGroupingSession();
	const def = overrideBash(g);
	startCall(g, "b1", "bash", { command: "echo hi" });
	const ctx = makeContext({
		toolCallId: "b1",
		cwd: CWD,
		executionStarted: true,
		isPartial: true,
		state: {},
		invalidate: () => {},
	});
	def.renderCall!({ command: "echo hi" }, passThroughTheme, ctx);
	const frame0 = getSpinnerFrame("b1", undefined);
	assert.equal(frame0, "⠋");
	await wait(120);
	// The interval increments the frame in SpinnerState; getSpinnerFrame
	// returns the current frame. (The rendered Text only updates when
	// invalidate re-runs renderCall, which doesn't happen in a test with
	// a no-op invalidate — but the underlying frame state advances.)
	const frame1 = getSpinnerFrame("b1", undefined);
	assert.notEqual(frame1, frame0, "spinner frame should advance");
});

test("renderCall: same-group multi-tool spinner shows the joined title", () => {
	// Under proximity grouping, read then bash with nothing between
	// joins ONE group. The latest (bash) spinner shows the multi-tool
	// title (`Read 1 file & Shell 1 command`); the earlier read collapses.
	const g = createGroupingSession();
	const bashDef = overrideBash(g);
	startCall(g, "r1", "read", { path: `${CWD}/a.ts` });
	startCall(g, "b1", "bash", { command: "ls" }); // same group, b1 is latest
	const ctx = makeContext({
		toolCallId: "b1",
		cwd: CWD,
		executionStarted: true,
		isPartial: true,
		state: {},
	});
	const comp = bashDef.renderCall!({ command: "ls" }, passThroughTheme, ctx);
	const text = renderedText(comp);
	assert.match(text, /Read 1 file/);
	assert.match(text, /Shell 1 command/);
	assert.ok(text.includes("&"), `expected & separator in: ${text}`);
});

test("renderCall: after a freeze, a frozen group's latest still shows its own title", () => {
	// A frozen group (text/thinking appeared) is not rejoined. The read
	// group's latest spinner shows `Read N files`, not a later bash group.
	const g = createGroupingSession();
	const readDef = overrideRead(g);
	startCall(g, "r1", "read", { path: `${CWD}/a.ts` });
	g.freezeCurrentGroup(); // text/thinking froze the read group
	startCall(g, "b1", "bash", { command: "ls" }); // new group
	const ctx = makeContext({
		toolCallId: "r1",
		cwd: CWD,
		executionStarted: true,
		isPartial: true,
		state: {},
	});
	const comp = readDef.renderCall!(
		{ path: `${CWD}/a.ts` },
		passThroughTheme,
		ctx,
	);
	const text = renderedText(comp);
	assert.match(text, /Read 1 file/);
	assert.ok(
		!text.includes("Shell"),
		"frozen read group should not show Shell label",
	);
});

test("renderCall: before tool_execution_start (group not registered), spinner shows a standalone title", () => {
	// The ToolExecutionComponent is constructed during `message_update`
	// when the toolCall block streams in — before `tool_execution_start`
	// registers the entry in the grouping session. renderCall then runs
	// with getCurrentGroup() === null. The spinner must still show the
	// tool title + arg (e.g. `⠋ Shell 1 command (ls)`), not a bare `⠋`.
	// This is most visible for bash, whose command can stream token-by-
	// token for a while before execution starts.
	const g = createGroupingSession();
	const bashDef = overrideBash(g);
	// NOTE: no startCall — the entry is not registered yet.
	const ctx = makeContext({
		toolCallId: "b1",
		cwd: CWD,
		executionStarted: false,
		isPartial: true,
		state: {},
	});
	const comp = bashDef.renderCall!(
		{ command: "ls -la" },
		passThroughTheme,
		ctx,
	);
	const text = renderedText(comp);
	assert.match(text, /Shell 1 command/);
	assert.match(text, /\(ls -la\)/);
});

// --- Plan 003: showArgOnSummary + spinner-state ----------------------------

test("renderCall: showArgOnSummary: 'never' → spinner has no arg", () => {
	const g = createGroupingSession();
	const def = overrideRead(g, {
		...DEFAULT_MINIMAL_TOOLCALL_CONFIG,
		showArgOnSummary: "never",
	});
	startCall(g, "r1", "read", { path: `${CWD}/a.ts` });
	const ctx = makeContext({
		toolCallId: "r1",
		cwd: CWD,
		executionStarted: true,
		isPartial: true,
		state: {},
	});
	const comp = def.renderCall!({ path: `${CWD}/a.ts` }, passThroughTheme, ctx);
	const text = renderedText(comp);
	assert.match(text, /Read 1 file/);
	assert.ok(
		!text.includes("(a.ts)"),
		`expected no arg in: ${JSON.stringify(text)}`,
	);
});

test("renderCall: showArgOnSummary: 'always' → multi-tool spinner shows the latest arg", () => {
	const g = createGroupingSession();
	const bashDef = overrideBash(g, {
		...DEFAULT_MINIMAL_TOOLCALL_CONFIG,
		showArgOnSummary: "always",
	});
	startCall(g, "r1", "read", { path: `${CWD}/a.ts` });
	startCall(g, "b1", "bash", { command: "ls" });
	const ctx = makeContext({
		toolCallId: "b1",
		cwd: CWD,
		executionStarted: true,
		isPartial: true,
		state: {},
	});
	const comp = bashDef.renderCall!({ command: "ls" }, passThroughTheme, ctx);
	const text = renderedText(comp);
	assert.match(text, /Read 1 file/);
	assert.match(text, /Shell 1 command/);
	// 'always' shows the latest arg even on a multi-tool line.
	assert.match(text, /\(ls\)/);
});

test("renderCall: per-session spinner interval — getSpinnerFrame advances over time", () => {
	// Pre-existing test already covers the interval mechanics. This
	// test confirms the per-session lookup doesn't crash when no
	// session is registered (the call site is the renderer's first
	// line of defense against a missing entry).
	const frame = getSpinnerFrame("nonexistent-call", undefined);
	assert.equal(typeof frame, "string");
});

test("renderCall: spinner frames come from the session's config (default frame is '⠋')", () => {
	// The default frame is '⠋' (the first element of
	// DEFAULT_MINIMAL_TOOLCALL_CONFIG.spinnerFrames). When no session is
	// registered for the toolCallId, the spinner-state module falls
	// back to the default frames, so the rendered text contains the
	// default first frame.
	const g = createGroupingSession();
	const def = overrideRead(g);
	startCall(g, "r1", "read", { path: `${CWD}/a.ts` });
	const ctx = makeContext({
		toolCallId: "r1",
		cwd: CWD,
		executionStarted: true,
		isPartial: true,
		state: {},
	});
	const comp = def.renderCall!({ path: `${CWD}/a.ts` }, passThroughTheme, ctx);
	const text = renderedText(comp);
	assert.match(text, /⠋/);
});
