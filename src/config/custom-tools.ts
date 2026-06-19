import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Container, Text } from "@earendil-works/pi-tui";
import {
	BODY_PREFIX,
	createGroupingSession,
	LEFT_PADDING,
} from "../grouping.js";
import { registerToolCallSession } from "../spinner-state.js";
import {
	argSummaryFor,
	clearCallText,
	clearSpinner,
	extractOutput,
	friendlyLabel,
	getOrCreateCallText,
	getOrCreateResultContainer,
	getOrCreateResultText,
	getSpinnerFrame,
} from "../tool-overrides.js";
import type {
	CustomToolOverrideConfig,
	MinimalToolcallConfig,
} from "./index.js";

type AnyToolDef = ToolDefinition<any, any, any>;

/**
 * Build a decorated `ToolDefinition` for a non-builtin extension
 * tool. Wraps the original `renderCall` and `renderResult` with this
 * package's minimal renderer; leaves `execute` untouched (we don't
 * re-implement the tool — we only style it).
 *
 * Each decorated tool gets its own `GroupingSession` so calls to
 * one custom tool don't merge with another custom tool (predictable
 * per-tool grouping). The grouping session is cheap; this is fine
 * for the typical handful of opt-in custom tools.
 *
 * The output mode is one of:
 * - `"hidden"` — collapsed shows tool + arg; result row is 0-line.
 * - `"summary"` — collapsed shows tool + arg; expanded shows
 *   the first line of the result.
 * - `"preview"` — collapsed shows tool + arg; expanded shows
 *   the full result (tail-capped by `config.expandedBodyMaxLines`).
 *
 * Errors keep the error text; the output mode is honored for the
 * non-error case only.
 */
export function decorateCustomTool(
	tool: AnyToolDef,
	overrideConfig: CustomToolOverrideConfig,
	sessionId: string,
	config: MinimalToolcallConfig,
): AnyToolDef {
	if (!overrideConfig.enabled) return tool;
	const grouping = createGroupingSession();
	const toolName = tool.name;
	const outputMode = overrideConfig.outputMode;
	return {
		...tool,
		renderShell: "self" as const,
		renderCall: (args, theme, context) => {
			const state = context?.state as Record<string, unknown> | undefined;
			const callText = getOrCreateCallText(state);
			if (context?.toolCallId) {
				grouping.registerInvalidate(context.toolCallId, context.invalidate);
				registerToolCallSession(context.toolCallId, sessionId);
			}
			if (context?.toolCallId && !grouping.isGroupLatest(context.toolCallId)) {
				clearSpinner(context.toolCallId);
				callText.setText("");
				return callText;
			}
			const frame = context?.toolCallId
				? getSpinnerFrame(context.toolCallId, context?.invalidate)
				: "⠋";
			const arg = argSummaryFor(toolName, args, context?.cwd ?? "");
			const label = friendlyLabel(toolName);
			// The decorator uses a per-tool grouping session; the call row
			// shows the tool's friendly label and the latest arg, joined
			// with a single space. Unlike the built-in overrides, the
			// arg always shows here (`showArgOnSummary` doesn't apply to
			// custom tools — the arg is the primary info, and the row is
			// single-line regardless of group state).
			const text = arg
				? `${LEFT_PADDING}${theme.fg("dim", frame)} ${theme.fg("dim", label)} ${theme.fg("text", `(${arg})`)}`
				: `${LEFT_PADDING}${theme.fg("dim", frame)} ${theme.fg("dim", label)}`;
			callText.setText(text);
			return callText;
		},
		renderResult: (result, options, theme, context) => {
			const state = context?.state as Record<string, unknown> | undefined;
			if (options.isPartial === true) {
				return getOrCreateResultText(state, () => new Text("", 0, 0));
			}
			clearSpinner(context.toolCallId);
			clearCallText(state);
			// Collapsed: 1-line summary with the tool label and the
			// latest arg, no diff suffix. The grouping session is per-tool
			// so a single custom tool's calls can be multi-call groups;
			// the latest arg is from the most recent entry.
			if (!options.expanded) {
				const group = grouping.getCurrentGroup(context.toolCallId);
				const latest = group?.entries.at(-1);
				const cwd = context.cwd;
				const arg = latest
					? argSummaryFor(toolName, latest.args, cwd)
					: argSummaryFor(toolName, context.args, cwd);
				const label = friendlyLabel(toolName);
				const head = arg
					? `${theme.fg("dim", label)} ${theme.fg("text", `(${arg})`)}`
					: `${theme.fg("dim", label)}`;
				const text = getOrCreateResultText(state, () => new Text("", 0, 0));
				(text as Text).setText(`${LEFT_PADDING}${head}`);
				return text;
			}
			// Expanded:
			if (outputMode === "hidden") {
				return getOrCreateResultText(state, () => new Text("", 0, 0));
			}
			const out = extractOutput(result);
			if (outputMode === "summary") {
				const first = out.split("\n")[0] ?? "(no output)";
				const text = getOrCreateResultText(state, () => new Text("", 0, 0));
				(text as Text).setText(`${BODY_PREFIX}${theme.fg("muted", first)}`);
				return text;
			}
			// "preview"
			const lines = out.split("\n");
			const cap = config.expandedBodyMaxLines;
			const showLines = lines.length > cap ? lines.slice(0, cap) : lines;
			const container = getOrCreateResultContainer(
				state,
				() => new Container(),
			);
			const c = container as Container;
			c.clear();
			for (const line of showLines) {
				c.addChild(new Text(`${BODY_PREFIX}${line}`, 0, 0));
			}
			if (lines.length > cap) {
				c.addChild(
					new Text(
						`${BODY_PREFIX}${theme.fg("dim", `… ${lines.length - cap} earlier line${lines.length - cap === 1 ? "" : "s"} not shown`)}`,
						0,
						0,
					),
				);
			}
			return c;
		},
	};
}
