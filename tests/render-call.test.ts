import assert from "node:assert/strict";
import test, { after } from "node:test";
import { Text } from "@earendil-works/pi-tui";
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

test("renderCall: spinner uses the entry's own group, not the most-recent tool's", () => {
	// When read and bash interleave, the read entry's spinner should show
	// "Read N files" (from the read group), not "Shell N commands" (from
	// the bash group). r1 is the latest in its (frozen) read group, so it
	// still renders a spinner — and that spinner uses getCurrentGroup("r1")
	// which returns the read group, not the bash group.
	const g = createGroupingSession();
	const readDef = overrideRead(g);
	startCall(g, "r1", "read", { path: `${CWD}/a.ts` });
	startCall(g, "b1", "bash", { command: "ls" }); // different tool, new group
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
	// r1 is the latest in its read group (bash froze it, didn't invalidate)
	assert.match(text, /Read 1 file/);
	assert.ok(
		!text.includes("Shell"),
		"should not show Shell label for a read call",
	);
});
