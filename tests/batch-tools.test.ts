import assert from "node:assert/strict";
import test, { after } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { registerBatchTools } from "../src/batch-tools.ts";
import { DEFAULT_MINIMAL_TOOLCALL_CONFIG } from "../src/config/index.ts";
import {
	clearSessionSpinnerOptions,
	registerToolCallSession,
	setSessionConfig,
} from "../src/spinner-state.ts";
import { clearAllSpinners } from "../src/tool-overrides.ts";
import {
	makeContext,
	passThroughTheme,
	renderedLineCount,
	renderedText,
} from "./helpers.ts";

after(() => clearAllSpinners());

// Capture tools registered by registerBatchTools via a fake pi.
function captureBatchTools(): Record<string, any> {
	const tools: Record<string, any> = {};
	const fakePi = {
		registerTool: (tool: any) => {
			tools[tool.name] = tool;
		},
	} as unknown as ExtensionAPI;
	registerBatchTools(fakePi);
	return tools;
}

test("batch: read_files collapsed shows 'Read N files'", () => {
	const tools = captureBatchTools();
	const def = tools["read_files"];
	const comp = def.renderResult(
		{
			content: [{ type: "text", text: "=== a ===\nA\n=== b ===\nB" }],
			details: {
				kind: "read",
				results: [
					{ key: "a", ok: true },
					{ key: "b", ok: true },
				],
			},
		},
		{ expanded: false, isPartial: false },
		passThroughTheme,
		makeContext({ state: {} }),
	);
	assert.match(renderedText(comp), /Read 2 files/);
});

test("batch: isPartial returns 0-line Text and does not clear spinner", () => {
	const tools = captureBatchTools();
	const def = tools["read_files"];
	const state: Record<string, unknown> = {};
	// Start the spinner via renderCall
	def.renderCall(
		{ paths: ["a.ts", "b.ts"] },
		passThroughTheme,
		makeContext({ toolCallId: "rb1", state }),
	);
	// Partial result (one item finished inside the batch)
	const comp = def.renderResult(
		{
			content: [{ type: "text", text: "=== a ===\nA" }],
			details: { kind: "read", results: [{ key: "a", ok: true }] },
		},
		{ expanded: false, isPartial: true },
		passThroughTheme,
		makeContext({ toolCallId: "rb1", state, isPartial: true }),
	);
	assert.equal(renderedLineCount(comp), 0, "partial should return 0-line Text");
	// Spinner should still be alive (call text still has content)
	const callText = state["__piMinimalToolcallCallText"] as Text | undefined;
	assert.ok(callText, "call text should exist");
	assert.match(renderedText(callText), /⠋/, "spinner should still be alive");
});

test("batch: final result clears spinner and shows summary", () => {
	const tools = captureBatchTools();
	const def = tools["read_files"];
	const state: Record<string, unknown> = {};
	// Start the spinner
	def.renderCall(
		{ paths: ["a.ts", "b.ts"] },
		passThroughTheme,
		makeContext({ toolCallId: "rb2", state }),
	);
	// Final result
	const comp = def.renderResult(
		{
			content: [{ type: "text", text: "=== a ===\nA\n=== b ===\nB" }],
			details: {
				kind: "read",
				results: [
					{ key: "a", ok: true },
					{ key: "b", ok: true },
				],
			},
		},
		{ expanded: false, isPartial: false },
		passThroughTheme,
		makeContext({ toolCallId: "rb2", state }),
	);
	assert.match(renderedText(comp), /Read 2 files/);
	// Spinner should be cleared
	const callText = state["__piMinimalToolcallCallText"] as Text | undefined;
	if (callText) {
		assert.equal(
			renderedText(callText),
			"",
			"spinner should be cleared after final result",
		);
	}
});

test("batch: expanded shows per-item ✓/✗ status", () => {
	const tools = captureBatchTools();
	const def = tools["edit_files"];
	const comp = def.renderResult(
		{
			content: [{ type: "text", text: "=== a ===\nok\n=== b ===\nERROR" }],
			details: {
				kind: "edit",
				results: [
					{ key: "a.ts", ok: true },
					{ key: "b.ts", ok: false, error: "not found" },
				],
			},
		},
		{ expanded: true, isPartial: false },
		passThroughTheme,
		makeContext({ state: {} }),
	);
	const text = renderedText(comp);
	assert.ok(text.includes("✓"), `expected ✓ for ok item in:\n${text}`);
	assert.ok(text.includes("✗"), `expected ✗ for failed item in:\n${text}`);
	assert.ok(text.includes("b.ts"), `expected failed item key in:\n${text}`);
});

test("batch: grep_files collapsed shows 'N searches'", () => {
	const tools = captureBatchTools();
	const def = tools["grep_files"];
	const comp = def.renderResult(
		{
			content: [{ type: "text", text: "results" }],
			details: {
				kind: "grep",
				results: [
					{ key: "foo", ok: true },
					{ key: "bar", ok: true },
					{ key: "baz", ok: true },
				],
			},
		},
		{ expanded: false, isPartial: false },
		passThroughTheme,
		makeContext({ state: {} }),
	);
	assert.match(renderedText(comp), /3 searches/);
});

test("batch: find_files collapsed shows 'N searches' (singular for 1)", () => {
	const tools = captureBatchTools();
	const def = tools["find_files"];
	const comp = def.renderResult(
		{
			content: [{ type: "text", text: "results" }],
			details: { kind: "find", results: [{ key: "*.ts", ok: true }] },
		},
		{ expanded: false, isPartial: false },
		passThroughTheme,
		makeContext({ state: {} }),
	);
	assert.match(renderedText(comp), /1 search/);
	assert.ok(!renderedText(comp).includes("1 searches"), "should be singular");
});

test("batch: tail-caps expanded output at default expandedBodyMaxLines (200)", () => {
	const tools = captureBatchTools();
	const def = tools["read_files"];
	const output = Array.from({ length: 300 }, (_, i) => `line${i}`).join("\n");
	const comp = def.renderResult(
		{
			content: [{ type: "text", text: output }],
			details: { kind: "read", results: [{ key: "big.ts", ok: true }] },
		},
		{ expanded: true, isPartial: false },
		passThroughTheme,
		makeContext({ state: {} }),
	);
	const text = renderedText(comp);
	assert.ok(text.includes("line299"), "tail should include the last line");
	assert.ok(!text.includes("line0"), "head should be truncated");
	assert.match(text, /earlier lines not shown/);
});

test("batch: respects per-session expandedBodyMaxLines override", () => {
	const tools = captureBatchTools();
	const def = tools["read_files"];
	const sessionId = "batch-cap-test-session";
	const toolCallId = "batch-cap-test-call";
	try {
		setSessionConfig(sessionId, {
			...DEFAULT_MINIMAL_TOOLCALL_CONFIG,
			expandedBodyMaxLines: 10,
		});
		registerToolCallSession(toolCallId, sessionId);
		const output = Array.from({ length: 50 }, (_, i) => `line${i}`).join("\n");
		const comp = def.renderResult(
			{
				content: [{ type: "text", text: output }],
				details: { kind: "read", results: [{ key: "x.ts", ok: true }] },
			},
			{ expanded: true, isPartial: false },
			passThroughTheme,
			makeContext({ toolCallId, state: {} }),
		);
		const text = renderedText(comp);
		assert.ok(text.includes("line49"), "tail (line49) should be visible");
		assert.ok(!text.includes("line30"), "lines 30..39 should be truncated");
		assert.match(text, /earlier lines not shown/);
	} finally {
		clearSessionSpinnerOptions(sessionId);
	}
});

test("batch: expandedBodyMaxLines=0 → empty body + footer (no slice(-0) leak)", () => {
	const tools = captureBatchTools();
	const def = tools["read_files"];
	const sessionId = "batch-cap-zero-session";
	const toolCallId = "batch-cap-zero-call";
	try {
		setSessionConfig(sessionId, {
			...DEFAULT_MINIMAL_TOOLCALL_CONFIG,
			expandedBodyMaxLines: 0,
		});
		registerToolCallSession(toolCallId, sessionId);
		const output = Array.from({ length: 10 }, (_, i) => `line${i}`).join("\n");
		const comp = def.renderResult(
			{
				content: [{ type: "text", text: output }],
				details: { kind: "read", results: [{ key: "x.ts", ok: true }] },
			},
			{ expanded: true, isPartial: false },
			passThroughTheme,
			makeContext({ toolCallId, state: {} }),
		);
		const text = renderedText(comp);
		// `slice(-0)` would have leaked all 10 body lines; assert none
		// render and the footer notes the truncation. The footer count
		// includes the per-item ✓/✗ rows, so just check the pattern.
		assert.ok(!text.includes("line0"), `expected no body lines in:\n${text}`);
		assert.ok(!text.includes("line9"), `expected no body lines in:\n${text}`);
		assert.match(text, /earlier lines not shown/);
	} finally {
		clearSessionSpinnerOptions(sessionId);
	}
});
