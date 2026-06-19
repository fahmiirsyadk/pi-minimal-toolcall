import assert from "node:assert/strict";
import { test } from "node:test";
import { Text } from "@earendil-works/pi-tui";
import {
	makeContext,
	passThroughTheme,
	renderedLineCount,
	renderedText,
} from "../../tests/helpers.ts";
import { decorateCustomTool } from "./custom-tools.js";
import { DEFAULT_MINIMAL_TOOLCALL_CONFIG } from "./index.js";

function makeTool(
	name = "my_tool",
	executeResult: { content: Array<{ type: "text"; text: string }> } = {
		content: [{ type: "text" as const, text: "ok" }],
	},
) {
	return {
		name,
		label: name,
		description: "test tool",
		promptSnippet: "test",
		parameters: { type: "object" as const, properties: {} },
		async execute() {
			return executeResult;
		},
	};
}

test("decorateCustomTool: enabled=false → returns the original tool unchanged", () => {
	const tool = makeTool();
	const result = decorateCustomTool(
		tool as unknown as Parameters<typeof decorateCustomTool>[0],
		{ enabled: false, outputMode: "summary" },
		"session-1",
		DEFAULT_MINIMAL_TOOLCALL_CONFIG,
	);
	assert.equal(result, tool);
});

test("decorateCustomTool: enabled=true, outputMode='hidden' → expanded returns 0-line (no cached state)", () => {
	const tool = makeTool("my_tool", {
		content: [{ type: "text" as const, text: "line1\nline2" }],
	});
	const def = decorateCustomTool(
		tool as unknown as Parameters<typeof decorateCustomTool>[0],
		{ enabled: true, outputMode: "hidden" },
		"session-1",
		DEFAULT_MINIMAL_TOOLCALL_CONFIG,
	);
	// Expanded only — fresh state, no prior collapsed call.
	const state: Record<string, unknown> = {};
	const ctx = makeContext({ toolCallId: "c1", cwd: "/p", state });
	const expanded = def.renderResult!(
		{
			content: [{ type: "text" as const, text: "line1\nline2" }],
			details: undefined,
		},
		{ expanded: true, isPartial: false },
		passThroughTheme,
		ctx,
	);
	assert.equal(renderedLineCount(expanded), 0);
});

test("decorateCustomTool: enabled=true, outputMode='summary' → expanded shows the first line of the result", () => {
	const tool = makeTool("my_tool", {
		content: [{ type: "text" as const, text: "first\nsecond\nthird" }],
	});
	const def = decorateCustomTool(
		tool as unknown as Parameters<typeof decorateCustomTool>[0],
		{ enabled: true, outputMode: "summary" },
		"session-1",
		DEFAULT_MINIMAL_TOOLCALL_CONFIG,
	);
	const state: Record<string, unknown> = {};
	const ctx = makeContext({ toolCallId: "c1", cwd: "/p", state });
	const expanded = def.renderResult!(
		{
			content: [{ type: "text" as const, text: "first\nsecond\nthird" }],
			details: undefined,
		},
		{ expanded: true, isPartial: false },
		passThroughTheme,
		ctx,
	);
	const text = renderedText(expanded);
	assert.match(text, /first/);
	assert.ok(!text.includes("second"), `expected no second line in: ${text}`);
});

test("decorateCustomTool: enabled=true, outputMode='preview' → expanded shows the first expandedBodyMaxLines of the result", () => {
	const lines = Array.from({ length: 50 }, (_, i) => `line${i}`).join("\n");
	const tool = makeTool("my_tool", {
		content: [{ type: "text" as const, text: lines }],
	});
	const def = decorateCustomTool(
		tool as unknown as Parameters<typeof decorateCustomTool>[0],
		{ enabled: true, outputMode: "preview" },
		"session-1",
		// The plan's recommended test setup: cap at 5.
		{ ...DEFAULT_MINIMAL_TOOLCALL_CONFIG, expandedBodyMaxLines: 5 },
	);
	const state: Record<string, unknown> = {};
	const ctx = makeContext({ toolCallId: "c1", cwd: "/p", state });
	const expanded = def.renderResult!(
		{ content: [{ type: "text" as const, text: lines }], details: undefined },
		{ expanded: true, isPartial: false },
		passThroughTheme,
		ctx,
	);
	const text = renderedText(expanded);
	// First 5 lines shown; later lines truncated.
	assert.match(text, /line0/);
	assert.match(text, /line4/);
	assert.ok(!text.includes("line5"), `expected line5 truncated: ${text}`);
	assert.match(text, /earlier line/);
});

test("decorateCustomTool: execute is passed through unchanged", async () => {
	const tool = makeTool("my_tool", {
		content: [{ type: "text" as const, text: "exec-output" }],
	});
	const def = decorateCustomTool(
		tool as unknown as Parameters<typeof decorateCustomTool>[0],
		{ enabled: true, outputMode: "summary" },
		"session-1",
		DEFAULT_MINIMAL_TOOLCALL_CONFIG,
	);
	// biome-ignore lint/suspicious/noExplicitAny: test-only
	const execute = (def as any).execute as (
		...args: unknown[]
	) => Promise<unknown>;
	const result = await execute("c1", {}, undefined, undefined, { cwd: "/p" });
	assert.ok(result && typeof result === "object");
	const r = result as { content: Array<{ type: string; text: string }> };
	assert.equal(r.content[0]?.text, "exec-output");
});

// Suppress the unused Text import warning (kept for type parity).
void Text;
