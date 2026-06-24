import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerBatchTools } from "./src/batch-tools.js";
import {
	debugLog,
	disposeAll,
	formatDoctorReport,
	getConfigPath,
	isDebugEnabled,
	loadConfig,
	type MinimalToolcallConfig,
	registerDisposable,
	runDoctor,
	setDebugEnabled,
} from "./src/config/index.js";
import { createGroupingSession, type GroupingSession } from "./src/grouping.js";
import {
	clearSessionSpinnerOptions,
	registerToolCallSession,
	setSessionConfig,
} from "./src/spinner-state.js";
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

/** Map of every built-in tool name to its override factory. Adding a
 *  new built-in override means updating this map AND the
 *  `TOOL_OVERRIDE_NAMES` tuple in `src/config/types.ts` so
 *  `registerToolOverrides` coverage and the per-tool config flag
 *  stay in lockstep. */
const TOOL_OVERRIDE_FACTORIES = {
	bash: overrideBash,
	read: overrideRead,
	edit: overrideEdit,
	write: overrideWrite,
	grep: overrideGrep,
	find: overrideFind,
	ls: overrideLs,
} as const;

function registerOverrides(
	pi: ExtensionAPI,
	grouping: GroupingSession,
	config: MinimalToolcallConfig,
): void {
	for (const [toolName, factory] of Object.entries(TOOL_OVERRIDE_FACTORIES)) {
		if (
			config.registerToolOverrides[
				toolName as keyof typeof config.registerToolOverrides
			]
		) {
			pi.registerTool(factory(grouping));
		}
	}
}

export default function (pi: ExtensionAPI) {
	// Per-session grouping state, keyed by `ctx.sessionManager.getSessionId()`.
	// Pi is single-session today, but a future concurrent-session process
	// would route events from each session to its own `GroupingSession`
	// without leaking group state.
	const groupings = new Map<string, GroupingSession>();
	// Per-session config, populated at `session_start` and consumed by
	// the override registration + the event handlers. Same key space
	// as `groupings`; the two are deleted together at `session_shutdown`.
	const configs = new Map<string, MinimalToolcallConfig>();

	// `customToolOverrides` is parsed + normalized but does not yet
	// affect rendering: the SDK's `pi.getAllTools()` returns
	// `ToolInfo` (metadata only), not the full `ToolDefinition`, so
	// wrapping a non-builtin tool's `execute` is not possible from
	// the extension layer. The field is preserved on disk so user
	// config is not lost when SDK support arrives.

	pi.on("session_start", async (_event, ctx) => {
		// Load the config (fingerprint-cached; tolerates a missing file
		// by returning the default). On parse error, fall back to the
		// default and surface the error via ctx.ui.notify.
		const { config, error } = loadConfig();
		const sessionId = ctx.sessionManager.getSessionId();
		configs.set(sessionId, config);
		setDebugEnabled(config.debug);
		if (config.debug) {
			debugLog("session", "session_start", {
				sessionId,
				toolsExpandedByDefault: config.toolsExpandedByDefault,
				groupingMode: config.groupingMode,
				customToolOverrides:
					Object.keys(config.customToolOverrides).length || undefined,
			});
		}

		if (ctx.hasUI) {
			ctx.ui.setToolsExpanded(config.toolsExpandedByDefault);
			ctx.ui.setHiddenThinkingLabel(config.hiddenThinkingLabel);
			if (error) {
				ctx.ui.notify(`pi-minimal-toolcall: ${error}`, "warning");
			}
		}

		const grouping = createGroupingSession(
			config.groupingMode === "consecutive"
				? { splitOnDifferentTool: true }
				: { splitOnDifferentTool: false },
		);
		setSessionConfig(sessionId, config);
		groupings.set(sessionId, grouping);
		// Track per-session state in the disposable registry so a
		// `/reload` cleans up after a `session_shutdown`. The grouping
		// session and spinner options are scoped to the session; the
		// next session_start re-creates them from the new config.
		registerDisposable(`config:${sessionId}`, () => configs.delete(sessionId));
		registerDisposable(`grouping:${sessionId}`, () =>
			groupings.delete(sessionId),
		);
		registerDisposable(`spinner-options:${sessionId}`, () =>
			clearSessionSpinnerOptions(sessionId),
		);
		registerOverrides(pi, grouping, config);
		if (config.batchToolsEnabled) {
			registerBatchTools(pi);
		}
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		const sessionId = ctx.sessionManager.getSessionId();
		debugLog("session", "session_shutdown", { sessionId });
		// Run the disposable registry: clears per-session state
		// (configs, groupings, session spinner options). Note: the
		// `pi.on(...)` event handlers and `pi.registerTool` calls are
		// not removable — the SDK tears down the entire
		// `ExtensionRunner` on reload and rebuilds it from the
		// extension's top-level re-invocation, so no listener or
		// tool-registration leak accumulates. The registry is
		// best-effort cleanup for the per-session Maps we own.
		const { disposed, errors } = disposeAll();
		if (errors.length > 0 && isDebugEnabled()) {
			for (const { label, error } of errors) {
				debugLog("dispose-error", label, String(error));
			}
		}
		if (isDebugEnabled()) {
			debugLog("dispose", "disposed", {
				count: disposed,
				errors: errors.length,
			});
		}
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
		const sessionId = ctx.sessionManager.getSessionId();
		const grouping = groupings.get(sessionId);
		const config = configs.get(sessionId);
		if (!grouping) return;
		registerToolCallSession(event.toolCallId, sessionId);
		grouping.onToolExecutionStart({
			toolCallId: event.toolCallId,
			toolName: event.toolName,
			args: event.args,
		});
		// "none" grouping mode: every call is its own row. We achieve
		// this by force-freezing after every `tool_execution_start`,
		// which causes the next call to open a fresh group. The current
		// call still joins a (1-entry) group and renders the normal
		// summary.
		if (config?.groupingMode === "none") {
			grouping.freezeCurrentGroup();
		}
	});

	// A new agent loop starts once per user prompt. Freeze the
	// currently-accumulating group so a run that ended on `bash` does
	// not absorb the next prompt's first `bash` into the same group
	// (e.g. `shell 8` then `shell 9` across the user's turn). The
	// previous group's last entry keeps its summary; the next tool
	// call starts a fresh group with a count of 1. Always on,
	// orthogonal to `groupingMode` (which controls text/thinking
	// freezes; this is prompt boundaries).
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
	// Gated on `groupingMode === "proximity"`: the other two modes
	// (`"consecutive"`, `"none"`) skip this freeze and rely on the
	// grouping session's internal policy.
	pi.on("message_update", (event, ctx) => {
		const t = event.assistantMessageEvent?.type;
		if (t !== "text_start" && t !== "thinking_start") return;
		const sessionId = ctx.sessionManager.getSessionId();
		const config = configs.get(sessionId);
		if (config?.groupingMode !== "proximity") return;
		const grouping = groupings.get(sessionId);
		grouping?.freezeCurrentGroup();
	});

	// Read-only diagnostic command. Prints the resolved config and any
	// likely footguns. The user invoked `/minimal-toolcall` before
	// 0.2.0; that command was removed in 0.2.0. This is the
	// replacement: shows the effective config without exposing a way
	// to mutate it (mutations go through the config file + `/reload`).
	pi.registerCommand("minimal-toolcall-doctor", {
		description:
			"Print the resolved pi-minimal-toolcall config and any likely footguns.",
		handler: async (_args, ctx) => {
			const report = runDoctor(getConfigPath());
			const text = formatDoctorReport(report);
			if (ctx.hasUI) {
				ctx.ui.notify(text, "info");
			} else {
				// Non-interactive modes (print, JSON, RPC) get a
				// console fallback so the command still does something
				// useful.
				console.log(text);
			}
		},
	});
}
