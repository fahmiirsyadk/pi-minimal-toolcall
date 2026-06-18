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
}
