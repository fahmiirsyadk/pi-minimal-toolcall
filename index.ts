import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerBatchTools } from "./src/batch-tools.js";
import { createGroupingSession, type GroupingSession } from "./src/grouping.js";
import {
	clearAllSpinners,
	overrideBash,
	overrideEdit,
	overrideFind,
	overrideGrep,
	overrideLs,
	overrideRead,
	overrideWrite,
} from "./src/tool-overrides.js";

const HIDDEN_THINKING_LABEL = "thinking";

function registerOverrides(pi: ExtensionAPI, grouping: GroupingSession): void {
	pi.registerTool(overrideBash(grouping));
	pi.registerTool(overrideRead(grouping));
	pi.registerTool(overrideEdit(grouping));
	pi.registerTool(overrideWrite(grouping));
	pi.registerTool(overrideGrep(grouping));
	pi.registerTool(overrideFind(grouping));
	pi.registerTool(overrideLs(grouping));
}

export default function (pi: ExtensionAPI) {
	// Per-session grouping state, keyed by `ctx.sessionManager.getSessionId()`.
	// Pi is single-session today, but a future concurrent-session process
	// would route events from each session to its own `GroupingSession`
	// without leaking group state.
	const groupings = new Map<string, GroupingSession>();

	pi.on("session_start", async (_event, ctx) => {
		// Calm defaults. The working indicator is suppressed, tool
		// blocks are collapsed (the per-group renderer draws one line;
		// `ctrl+o` expands inline via the native `setToolsExpanded`
		// mechanism), and thinking blocks are hidden behind a minimal
		// label. Users can still expand with `ctrl+o` / `ctrl+t`; we
		// only change the resting state.
		if (ctx.hasUI) {
			ctx.ui.setWorkingVisible(false);
			ctx.ui.setToolsExpanded(false);
			ctx.ui.setHiddenThinkingLabel(HIDDEN_THINKING_LABEL);
		}

		const grouping = createGroupingSession();
		groupings.set(ctx.sessionManager.getSessionId(), grouping);
		registerOverrides(pi, grouping);
		registerBatchTools(pi);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		groupings.delete(ctx.sessionManager.getSessionId());
		// Release any spinner intervals still alive from in-flight calls
		// that never produced a result (e.g. aborted mid-execution).
		clearAllSpinners();
	});

	// Track tool execution order so the chat renderer can group consecutive
	// same-tool calls into a single row that updates in place. Pi calls
	// `requestRender()` after `tool_execution_start`, so the previous
	// entry's renderer re-runs with the updated state and collapses to a
	// 0-line Text. The new entry becomes the "current" entry and renders
	// the summary.
	pi.on("tool_execution_start", (event, ctx) => {
		const grouping = groupings.get(ctx.sessionManager.getSessionId());
		if (grouping) {
			grouping.onToolExecutionStart({
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				args: event.args,
			});
		}
	});

	// A new agent loop starts once per user prompt. Freeze the
	// currently-accumulating group so a run that ended on `bash` does
	// not absorb the next prompt's first `bash` into the same group
	// (e.g. `shell 8` then `shell 9` across the user's turn). The
	// previous group's last entry keeps its summary; the next tool
	// call starts a fresh group with a count of 1.
	pi.on("agent_start", (_event, ctx) => {
		const grouping = groupings.get(ctx.sessionManager.getSessionId());
		grouping?.freezeCurrentGroup();
	});

	// Proximity grouping: a text or thinking block between tool calls
	// freezes the current group, so calls separated by prose/thinking do
	// not merge into one shifting row. `message_update` streams
	// token-by-token with an `assistantMessageEvent` whose `type` marks
	// the start of each content block. Freezing on `text_start` /
	// `thinking_start` lands the boundary *before* the next tool call's
	// `tool_execution_start`, so a run like `read, read → thinking →
	// bash` produces two groups (`Read 2 files`, then `Shell 1 command`)
	// that render where their calls actually ran, instead of compounding
	// `Shell` across the thinking. A turn that emits only tool calls (no
	// text/thinking) fires no such event, so its tools join the previous
	// group — matching the "no text or thinking in between → group" rule.
	pi.on("message_update", (event, ctx) => {
		const t = event.assistantMessageEvent?.type;
		if (t !== "text_start" && t !== "thinking_start") return;
		const grouping = groupings.get(ctx.sessionManager.getSessionId());
		grouping?.freezeCurrentGroup();
	});
}
