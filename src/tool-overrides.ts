import { readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type { Theme, ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
	createBashToolDefinition,
	createEditToolDefinition,
	createFindToolDefinition,
	createGrepToolDefinition,
	createLsToolDefinition,
	createReadToolDefinition,
	createWriteToolDefinition,
	getLanguageFromPath,
	highlightCode,
	keyHint,
} from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { Container, Text } from "@earendil-works/pi-tui";
import type { MinimalToolcallConfig } from "./config/index.js";
import { DEFAULT_MINIMAL_TOOLCALL_CONFIG } from "./config/index.js";
import {
	BODY_PREFIX,
	type CurrentGroup,
	formatDiffSuffix,
	type GroupingSession,
	LEFT_PADDING,
	nounFor,
	renderGroupTitleCore,
} from "./grouping.js";
import {
	getSessionIdForToolCall,
	getSessionSpinnerOptions,
	unregisterToolCallSession,
} from "./spinner-state.js";

type AnyToolDef = ToolDefinition<any, any, any>;
type ToolFactory = (cwd: string) => AnyToolDef;

/** Max body lines shown inline when expanded. Larger output shows a footer
 * noting how many earlier lines were not stored. */
export const EXPANDED_BODY_MAX_LINES = 50;

interface SpinnerState {
	frame: number;
	invalidate: (() => void) | undefined;
	interval: ReturnType<typeof setInterval>;
}

const spinnerStates = new Map<string, SpinnerState>();

const WRITE_META_STATE_KEY = "__piMinimalToolcallWriteMeta";

interface WriteExecutionMeta {
	previousContent: string | undefined;
	fileExistedBeforeWrite: boolean;
}

export function getSpinnerFrame(
	toolCallId: string,
	invalidate: (() => void) | undefined,
): string {
	const sessionId = getSessionIdForToolCall(toolCallId);
	const { frames, intervalMs } = getSessionSpinnerOptions(sessionId);
	const existing = spinnerStates.get(toolCallId);
	if (existing) {
		if (invalidate) existing.invalidate = invalidate;
		return frames[existing.frame] ?? "";
	}
	const state: SpinnerState = {
		frame: 0,
		invalidate,
		interval: undefined as unknown as ReturnType<typeof setInterval>,
	};
	state.interval = setInterval(() => {
		const s = spinnerStates.get(toolCallId);
		if (!s) return;
		const sid = getSessionIdForToolCall(toolCallId);
		const opts = getSessionSpinnerOptions(sid);
		s.frame = (s.frame + 1) % opts.frames.length;
		try {
			s.invalidate?.();
		} catch {
			// component may have been destroyed; the next renderResult
			// or session_shutdown will clean up
		}
	}, intervalMs);
	spinnerStates.set(toolCallId, state);
	return frames[state.frame] ?? "";
}

export function clearSpinner(toolCallId: string): void {
	const state = spinnerStates.get(toolCallId);
	if (!state) return;
	clearInterval(state.interval);
	spinnerStates.delete(toolCallId);
	unregisterToolCallSession(toolCallId);
}

/** Clear all active spinners. Call from `session_shutdown` to release
 * intervals for any in-flight calls that never produced a result. */
export function clearAllSpinners(): void {
	for (const state of spinnerStates.values()) {
		clearInterval(state.interval);
	}
	spinnerStates.clear();
}

const CALL_TEXT_STATE_KEY = "__piMinimalToolcallCallText";
const RESULT_COLLAPSED_KEY = "__piMinimalToolcallResultText";
const RESULT_EXPANDED_KEY = "__piMinimalToolcallResultContainer";

/** Get (or create and stash) the persistent call-line `Text` for this tool
 * call. The TUI renders both `renderCall` and `renderResult` as separate
 * rows, so the spinner must live in a `Text` we can clear (`setText("")`)
 * in `renderResult` — otherwise the stale spinner row persists alongside
 * the summary. */
export function getOrCreateCallText(
	state: Record<string, unknown> | undefined,
): Text {
	let callText = state?.[CALL_TEXT_STATE_KEY] as Text | undefined;
	if (!callText) {
		callText = new Text("", 0, 0);
		if (state) state[CALL_TEXT_STATE_KEY] = callText;
	}
	return callText;
}

/** Clear the persistent call-line `Text` so the spinner row disappears
 * when the result lands. Call from `renderResult` only for the final
 * (non-partial) result — partial updates must keep the call row's
 * spinner alive. */
export function clearCallText(
	state: Record<string, unknown> | undefined,
): void {
	(state?.[CALL_TEXT_STATE_KEY] as Text | undefined)?.setText("");
}

/** Get (or create and stash) a persistent collapsed-summary `Text` for
 * this tool call. Reusing the same instance across `renderResult` calls
 * (including bash's per-tick `onUpdate` partials) lets the TUI diff the
 * in-place update instead of seeing a brand-new component each tick,
 * which would otherwise repaint the row on every streaming update. */
export function getOrCreateResultText(
	state: Record<string, unknown> | undefined,
	factory: () => Text,
): Text {
	let text = state?.[RESULT_COLLAPSED_KEY] as Text | undefined;
	if (!text) {
		text = factory();
		if (state) state[RESULT_COLLAPSED_KEY] = text;
	}
	return text;
}

/** Get (or create and stash) a persistent expanded-view `Container` for
 * this tool call. Stored under a separate key from the collapsed `Text`
 * so toggling expanded ↔ collapsed does not reuse one as the other. */
function getOrCreateResultContainer(
	state: Record<string, unknown> | undefined,
	factory: () => Container,
): Container {
	let container = state?.[RESULT_EXPANDED_KEY] as Container | undefined;
	if (!container) {
		container = factory();
		if (state) state[RESULT_EXPANDED_KEY] = container;
	}
	return container;
}

function captureWriteMeta(
	args: unknown,
	cwd: string,
): WriteExecutionMeta | undefined {
	if (!args || typeof args !== "object") return undefined;
	const rawPath = (args as Record<string, unknown>)["path"];
	if (typeof rawPath !== "string" || !rawPath) return undefined;
	const absolutePath = isAbsolute(rawPath) ? rawPath : join(cwd, rawPath);
	try {
		const previousContent = readFileSync(absolutePath, "utf-8");
		return { previousContent, fileExistedBeforeWrite: true };
	} catch {
		return { previousContent: undefined, fileExistedBeforeWrite: false };
	}
}

interface DiffNetLines {
	added: number;
	removed: number;
}

export function parsePatchNetLines(
	patch: string | undefined,
): DiffNetLines | undefined {
	if (!patch) return undefined;
	let added = 0;
	let removed = 0;
	let sawHunkHeader = false;
	for (const line of patch.split("\n")) {
		// Hunk headers mark the boundary between file headers and content.
		if (line.startsWith("@@")) {
			sawHunkHeader = true;
			continue;
		}
		// Only skip the file headers (`--- a/file` / `+++ b/file`) before
		// the first hunk. After a hunk header, all `+`/`-` lines are
		// content — even if the content starts with `--` or `++`, which
		// would make the line render as `---- foo` or `+++ bar` and be
		// wrongly skipped by a naive `startsWith("---")` check.
		if (!sawHunkHeader && (/^---\s/.test(line) || /^\+\+\+\s/.test(line)))
			continue;
		if (line.startsWith("+")) added++;
		else if (line.startsWith("-")) removed++;
	}
	return { added, removed };
}

function computeDiffInfo(
	toolName: string,
	result: {
		details?: unknown;
		content?: Array<{ type: string; text?: string }>;
	},
	context: { args?: unknown; state?: Record<string, unknown> },
): DiffNetLines | undefined {
	if (toolName === "edit") {
		const details = result.details as { patch?: string } | undefined;
		return parsePatchNetLines(details?.patch);
	}
	if (toolName === "write") {
		const args = context.args as { content?: string } | undefined;
		const carrier = context.state;
		const meta = carrier?.[WRITE_META_STATE_KEY] as
			| WriteExecutionMeta
			| undefined;
		const newContent = typeof args?.content === "string" ? args.content : "";
		const newLines = newContent.length > 0 ? newContent.split("\n").length : 0;
		if (
			meta?.fileExistedBeforeWrite &&
			typeof meta.previousContent === "string"
		) {
			const oldLines = meta.previousContent.split("\n").length;
			return { added: newLines, removed: oldLines };
		}
		return { added: newLines, removed: 0 };
	}
	return undefined;
}

function withSelfShell<T extends AnyToolDef>(def: T): T {
	return { ...def, renderShell: "self" as const };
}

export function extractOutput(result: {
	content: Array<{ type: string; text?: string }>;
}): string {
	return result.content
		.filter((c): c is { type: "text"; text: string } => c.type === "text")
		.map((c) => c.text)
		.join("");
}

export function relPath(cwd: string, p: string): string {
	if (!p) return p;
	if (!cwd) return p;
	if (p === cwd) return ".";
	if (p.startsWith(`${cwd}/`)) return p.slice(cwd.length + 1);
	return p;
}

function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function shortCommand(cwd: string, command: string): string {
	if (!cwd || !command) return command;
	// Only replace `cwd` when it appears as a path token — preceded by
	// start/whitespace/quote/equals and followed by `/` or end/whitespace.
	// A naive `split(cwd).join(".")` also rewrites paths that merely
	// contain cwd as a substring (e.g. cwd=/home/user, command references
	// /home/user-backup → `.-backup`).
	return command
		.replace(new RegExp(escapeRegex(`${cwd}/`), "g"), "./")
		.replace(
			new RegExp(
				`(^|\\s|[="'\`(\\[{])${escapeRegex(cwd)}(?=\\s|$|[;&|<>)]|$)`,
				"g",
			),
			"$1.",
		);
}

/**
 * Build a minimal `renderShell: "self"` override of a built-in tool. The
 * factory's static fields (name, label, description, promptSnippet,
 * parameters) are cwd-independent; we sample them once with an empty cwd
 * and spread them. The override's `execute` re-evaluates the factory
 * against `ctx.cwd` on every call, so live cwd changes are honored.
 * `grouping` is the per-session `GroupingSession`; the override's
 * `renderResult` consults it to collapse earlier entries in a group.
 */
function makeOverride(
	factory: ToolFactory,
	grouping: GroupingSession,
	config: MinimalToolcallConfig = DEFAULT_MINIMAL_TOOLCALL_CONFIG,
): AnyToolDef {
	const {
		execute: _execute,
		renderCall: _renderCall,
		renderResult: _renderResult,
		...staticShape
	} = factory("");
	const toolName = staticShape.name as string;
	return withSelfShell({
		...staticShape,
		execute: (toolCallId, params, signal, onUpdate, ctx) =>
			factory(ctx.cwd).execute(toolCallId, params, signal, onUpdate, ctx),
		// During execution, render a one-line spinner (frame + multi-tool
		// group title) on a persistent `Text` stashed in `context.state`.
		// The TUI shows both `renderCall` and `renderResult` as separate
		// rows, so the spinner must live on a `Text` we can clear
		// (`setText("")`) in `renderResult` — otherwise the stale spinner
		// row persists alongside the summary. The spinner frame cycles
		// every 80ms via `context.invalidate`. For `write`, we also capture
		// the file's pre-execution content in `context.state` so the
		// summary can show `+N -M` diff net lines after execution.
		renderCall: (args, theme, context) => {
			const toolCallId = context?.toolCallId ?? "";
			const cwd = context?.cwd ?? "";
			const state = context?.state as Record<string, unknown> | undefined;
			const callText = getOrCreateCallText(state);
			// Register invalidate early so grouping can collapse this entry
			// when a new same-tool call joins, even before the result lands.
			if (toolCallId) {
				grouping.registerInvalidate(toolCallId, context?.invalidate);
			}
			// Capture write meta before execution overwrites the file.
			// Only capture on the first renderCall for this entry so the
			// pre-execution content is preserved (later renderCall ticks —
			// every 80ms while the spinner is running — would otherwise
			// re-read the now-written file and overwrite the meta with the
			// post-write content, breaking the `+N -M` diff).
			if (toolName === "write" && !state?.[WRITE_META_STATE_KEY]) {
				const meta = captureWriteMeta(args, cwd);
				if (meta && state) state[WRITE_META_STATE_KEY] = meta;
			}
			// Only the last entry in the group shows the spinner; earlier
			// entries collapse to 0-line so the chat shows one row per
			// group, not one row per in-flight call.
			if (toolCallId && !grouping.isGroupLatest(toolCallId)) {
				clearSpinner(toolCallId);
				callText.setText("");
				return callText;
			}
			const frame = toolCallId
				? getSpinnerFrame(toolCallId, context?.invalidate)
				: "⠋";
			const group = grouping.getCurrentGroup(toolCallId);
			callText.setText(
				formatSpinnerLine(
					group,
					frame,
					toolName,
					args,
					theme,
					cwd,
					config.showArgOnSummary,
					config.showErrorMark,
				),
			);
			return callText;
		},
		// Group proximity-consecutive tool calls (no text/thinking between
		// them) into a single row that updates in place, regardless of tool
		// name. Only the last entry in the group renders anything; earlier
		// entries return a 0-line `Text`, so the chat collapses them and the
		// counts shown reflect the cumulative state.
		//
		// Collapsed: 1 line (`<title-core> [(arg)] [+N -M] ctrl+o to expand`,
		// where `<title-core>` is `Shell 3 commands & Read 1 file` for a
		// multi-tool group or `Read 2 files` for a single-tool group).
		// Expanded: a Container with header + body + footer. The user toggles
		// via the native `setToolsExpanded` mechanism (`ctrl+o`); the TUI's
		// diff sees the line-count change and re-renders.
		//
		// Streaming tools (e.g. `bash`) call `renderResult` repeatedly with
		// `options.isPartial === true` via `onUpdate`. For partial calls we
		// keep the call row's spinner alive (no cleanup) and return a stable
		// 0-line `Text` so the spinner stays the only visible artifact of
		// the in-flight call. The final call clears the spinner and renders
		// the collapsed summary or expanded Container. Result components
		// (Text and Container) are cached in `context.state` and reused
		// across calls so partial updates and post-render invalidations
		// repaint the same instance instead of allocating a new one each
		// tick — the SDK's bash `renderResult` uses the same
		// `context.lastComponent` trick.
		renderResult: (result, options, theme, context) => {
			const state = context?.state as Record<string, unknown> | undefined;
			const isPartial = options.isPartial === true;
			// Register the component's invalidate hook so that when a new
			// entry joins the same group, `onToolExecutionStart` can call
			// this to collapse the call row (and, for earlier entries, the
			// result row).
			grouping.registerInvalidate(context.toolCallId, context.invalidate);
			if (isPartial) {
				// Streaming update (e.g. bash `onUpdate`): keep the call
				// row's spinner running and the call line populated. Return
				// a stable 0-line Text so the TUI does not allocate a new
				// result component on every throttle tick.
				return getOrCreateResultText(state, () => new Text("", 0, 0));
			}
			// Final result: stop the spinner and clear the call line so
			// only the result row shows (the TUI renders both call and
			// result rows as separate rows).
			clearSpinner(context.toolCallId);
			clearCallText(state);
			const group = grouping.getCurrentGroup(context.toolCallId);
			if (!group) {
				return getOrCreateResultText(state, () => new Text("", 0, 0));
			}
			const diffInfo = computeDiffInfo(toolName, result, context);
			// Store this entry's final result on the group so the expanded
			// view can render every call in the group, not just the latest.
			// The numeric `diffInfo` is aggregated across the group for the
			// collapsed summary and formatted per-entry in the expanded view.
			grouping.storeResult(
				context.toolCallId,
				result as {
					content: Array<{ type: string; text?: string }>;
					details?: unknown;
				},
				context.isError,
				diffInfo,
			);
			const isLatest = grouping.isGroupLatest(context.toolCallId);

			if (!isLatest) {
				// Earlier entry in its group. The chat shows one row per
				// group (the latest), so a collapsed earlier entry renders
				// 0 lines. If the user previously expanded this entry
				// (while it was the latest) and a new same-tool call landed
				// afterwards, the cached expanded Container is still in
				// state — rebuild it from the group's stored results. This
				// preserves the expanded view instead of silently dropping
				// it. Entries that were never expanded stay 0-line on a
				// global expand toggle.
				if (!options.expanded) {
					return new Text("", 0, 0);
				}
				const cached = state?.[RESULT_EXPANDED_KEY] as Component | undefined;
				if (!cached) {
					return new Text("", 0, 0);
				}
				return populateExpandedGroup(cached, {
					group,
					theme,
					cwd: context.cwd,
					isLatest: false,
					config,
				});
			}

			if (!options.expanded) {
				// Collapsed: reuse a stable 1-line Text. Toggling expanded
				// re-runs this branch and falls through to the expanded
				// path below; the two are stored under separate keys so the
				// types never collide.
				const summary = getOrCreateResultText(state, () => new Text("", 0, 0));
				(summary as Text).setText(
					grouping.renderGroupSummary(group, theme, context.cwd, {
						showDiffSuffix: config.showDiffSuffix,
						showErrorMark: config.showErrorMark,
					}),
				);
				return summary;
			}
			// Expanded: reuse a stable Container; rebuild its children in
			// place from every entry in the group. Subsequent `onUpdate`
			// partials collapse via the `isPartial` branch above, and
			// post-render `invalidate` calls repaint the same Container
			// instead of swapping it out.
			return populateExpandedGroup(
				getOrCreateResultContainer(state, () => new Container()),
				{
					group,
					theme,
					cwd: context.cwd,
					isLatest: true,
					config,
				},
			);
		},
	});
}

function formatSpinnerLine(
	group: CurrentGroup | null,
	frame: string,
	toolName: string,
	args: unknown,
	theme: Theme,
	cwd: string,
	showArgOnSummary: MinimalToolcallConfig["showArgOnSummary"],
	showErrorMark: boolean,
): string {
	// Helper: should the arg appear on this line? `"always"` →
	// everywhere. `"single-only"` → only when the group has one
	// distinct tool. `"never"` → never.
	const shouldShowArg = (distinctSize: number) =>
		showArgOnSummary === "always" ||
		(showArgOnSummary === "single-only" && distinctSize === 1);

	if (!group || group.entries.length === 0) {
		// The ToolExecutionComponent is constructed during `message_update`
		// when the toolCall block streams in — BEFORE `tool_execution_start`
		// registers the entry in the grouping session. The constructor's
		// `renderCall()` therefore runs with no group yet. Render a
		// standalone title from the current tool so the spinner shows
		// `⠋ Shell 1 command (cmd)` instead of a bare `⠋` during the
		// args-stream phase (longest for bash, whose command can stream
		// token-by-token). Once `tool_execution_start` fires, the entry is
		// registered and the full group title takes over.
		const label = friendlyLabel(toolName);
		const arg = shouldShowArg(1) ? argSummaryFor(toolName, args, cwd) : "";
		const countPart = `1 ${nounFor(toolName, 1)}`;
		return arg
			? `${LEFT_PADDING}${theme.fg("dim", frame)} ${theme.fg("accent", label)} ${theme.fg("text", countPart)} ${theme.fg("muted", `(${arg})`)}`
			: `${LEFT_PADDING}${theme.fg("dim", frame)} ${theme.fg("accent", label)} ${theme.fg("text", countPart)}`;
	}
	// Multi-tool group title (`Shell 2 commands & Read 1 file`),
	// accent-colored to match the resting expanded header. The live
	// per-tool counts tick up as each call starts. The per-tool `✗`
	// is gated on `showErrorMark` (the expanded view always shows
	// per-entry ✓/✗, only the collapsed summary respects the knob).
	const core = renderGroupTitleCore(group, theme, "accent", showErrorMark);
	// Show the running arg only for single-tool groups (a multi-tool
	// spinner line is already busy; per-tool args would be noise). The
	// current entry is the latest in the group, so its `args` are the
	// latest arg.
	const distinct = new Set(group.entries.map((e) => e.toolName));
	let argSuffix = "";
	if (shouldShowArg(distinct.size)) {
		const arg = argSummaryFor(toolName, args, cwd);
		argSuffix = arg ? ` ${theme.fg("muted", `(${arg})`)}` : "";
	}
	return `${LEFT_PADDING}${theme.fg("dim", frame)} ${core}${argSuffix}`;
}

interface ExpandedGroupArgs {
	group: NonNullable<ReturnType<GroupingSession["getCurrentGroup"]>>;
	theme: Parameters<NonNullable<AnyToolDef["renderResult"]>>[2];
	cwd: string;
	/** True when this render is for the latest entry in the group (the
	 * one the user is expanding). False when re-rendering an earlier
	 * entry's preserved expanded view. Only affects the footer. */
	isLatest: boolean;
	/** Per-session config — controls the body tail-cap, the
	 * `writeExpandMode`, and the per-entry `✓/✗` status. */
	config: MinimalToolcallConfig;
}

/** Format a duration in ms as a short string: `< 1s` → `Xms`, `≥ 1s` → `X.Xs`.
 * Matches the SDK bash's `formatDuration` format. */
export function formatDuration(ms: number | undefined): string {
	if (ms === undefined) return "";
	if (ms < 1000) return `${ms}ms`;
	return `${(ms / 1000).toFixed(1)}s`;
}

/** Render the full written file content for the expanded view of a `write`
 * call, matching what the native Pi write tool shows on expand. The write
 * result's text is just `Successfully wrote N bytes to <path>` — useful as a
 * collapsed status but useless when expanded, where the user wants to see
 * the actual code that was written. The content comes from `args.content`
 * (the model's input), syntax-highlighted by the path's language. Tabs are
 * replaced with 3 spaces and trailing empty lines trimmed, mirroring the
 * native `formatWriteCall`. Errors keep the error text (there is no
 * content to show when the write failed). */
function renderWriteContentLines(
	args: unknown,
	theme: Parameters<NonNullable<AnyToolDef["renderResult"]>>[2],
): Array<{ prefix: string; text: string }> {
	if (!args || typeof args !== "object") return [];
	const a = args as Record<string, unknown>;
	const rawPath = String(a["path"] ?? a["file_path"] ?? "");
	const content = typeof a["content"] === "string" ? a["content"] : "";
	if (content.length === 0) return [];
	const lang = rawPath ? getLanguageFromPath(rawPath) : undefined;
	// `normalizeDisplayText` just strips CR; replicate inline to avoid
	// depending on the unexported SDK helper.
	const normalized = content.replace(/\r/g, "");
	const renderedLines = lang
		? highlightCode(normalized, lang)
		: normalized
				.split("\n")
				.map((l) => theme.fg("toolOutput", l.replace(/\t/g, "   ")));
	// Trim trailing empty lines (matches the native write renderer).
	let end = renderedLines.length;
	while (end > 0 && renderedLines[end - 1] === "") end--;
	return renderedLines
		.slice(0, end)
		.map((line) => ({ prefix: BODY_PREFIX, text: line }));
}

/** Render a unified-diff patch with `+`/`-` coloring for the expanded view.
 * File headers (`--- a/f` / `+++ b/f`) and hunk headers (`@@`) are dimmed;
 * added lines are success-colored, removed lines error-colored, context
 * lines muted. This shows the full diff data that the text-only
 * `extractOutput` misses (edit's text is just "Successfully replaced N
 * block(s)"). */
function renderPatchLines(
	patch: string,
	theme: Parameters<NonNullable<AnyToolDef["renderResult"]>>[2],
): Array<{ prefix: string; text: string }> {
	const items: Array<{ prefix: string; text: string }> = [];
	for (const line of patch.split("\n")) {
		if (line === "") continue;
		let styled: string;
		if (line.startsWith("@@")) {
			styled = theme.fg("dim", line);
		} else if (line.startsWith("+++ ") || line.startsWith("--- ")) {
			styled = theme.fg("dim", line);
		} else if (line.startsWith("+")) {
			styled = theme.fg("success", line);
		} else if (line.startsWith("-")) {
			styled = theme.fg("error", line);
		} else {
			styled = theme.fg("muted", line);
		}
		items.push({ prefix: BODY_PREFIX, text: styled });
	}
	return items;
}

/** Rebuild the children of an expanded `Container` in place. Renders
 * every entry in the group: a per-entry header (`✓/✗ <arg> <diff>
 * <duration>`) followed by that entry's text output AND its diff/patch
 * (for `edit` entries, the patch from `details.patch` — the text alone
 * is just "Successfully replaced N block(s)" and misses the actual
 * diff). The combined body is tail-capped at `EXPANDED_BODY_MAX_LINES
 * * 4` lines so a huge group does not flood the TUI; a `… N earlier
 * lines not shown` footer notes the truncation. Reusing one
 * `Container` across `renderResult` calls lets the TUI diff the update
 * against the previously rendered content rather than seeing a
 * brand-new component each call. */
function populateExpandedGroup(
	container: Component,
	args: ExpandedGroupArgs,
): Component {
	const { group, theme, cwd, isLatest, config } = args;
	const { entries } = group;
	const collapseHint = keyHint("app.tools.expand", "to collapse");
	const count = entries.length;
	// Multi-tool group title (`Read 3 files & Edit 1 file`),
	// accent-colored. The aggregated diff is dropped on expand — it is
	// shown per-entry below.
	const titleCore = renderGroupTitleCore(group, theme, "accent");

	// Collect every line (group title + per-entry header/body/diff) so we
	// can tail-cap the total in one pass.
	const items: Array<{ prefix: string; text: string }> = [
		{
			prefix: LEFT_PADDING,
			text: `${titleCore} ${theme.fg("dim", collapseHint)}`,
		},
	];
	for (const entry of entries) {
		const argSummary = argSummaryFor(entry.toolName, entry.args, cwd);
		const statusMark = entry.isError
			? theme.fg("error", "✗")
			: theme.fg("success", "✓");
		const diff = entry.diffInfo ? formatDiffSuffix(entry.diffInfo, theme) : "";
		const dur = formatDuration(entry.durationMs);
		const durPart = dur ? ` ${theme.fg("dim", dur)}` : "";
		const headerText = argSummary
			? `${statusMark} ${theme.fg("muted", argSummary)}${diff}${durPart}`
			: `${statusMark}${diff}${durPart}`;
		items.push({ prefix: LEFT_PADDING, text: headerText });
		// Body content. For `write`, the result text is just
		// `Successfully wrote N bytes to <path>` — useless when expanded.
		// Show the full written content from `args.content` instead
		// (syntax-highlighted by path), matching the native Pi write
		// expand. The `writeExpandMode` config controls which of
		// {content, summary, both} is rendered. On error there is no
		// content to show, so fall back to the error text. For all
		// other tools, the text output is the real body (bash stdout,
		// read file contents, edit's status line).
		if (entry.toolName === "write" && !entry.isError) {
			if (config.writeExpandMode === "summary") {
				// Native status line only.
				const output = entry.output ?? "(no output)";
				for (const line of output.split("\n")) {
					items.push({ prefix: BODY_PREFIX, text: line });
				}
			} else if (config.writeExpandMode === "content") {
				// Full written content only.
				const writeLines = renderWriteContentLines(entry.args, theme);
				if (writeLines.length > 0) {
					items.push(...writeLines);
				} else {
					items.push({ prefix: BODY_PREFIX, text: "(no content)" });
				}
			} else {
				// "both" — content first, then the native status line.
				const writeLines = renderWriteContentLines(entry.args, theme);
				if (writeLines.length > 0) {
					items.push(...writeLines);
				} else {
					items.push({ prefix: BODY_PREFIX, text: "(no content)" });
				}
				const output = entry.output ?? "";
				if (output) {
					for (const line of output.split("\n")) {
						items.push({ prefix: BODY_PREFIX, text: line });
					}
				}
			}
		} else {
			const output = entry.output ?? "";
			const bodyLines =
				output.length > 0 ? output.split("\n") : ["(no output)"];
			for (const line of bodyLines) {
				items.push({ prefix: BODY_PREFIX, text: line });
			}
		}
		// For edit entries, render the full diff patch (the text output is
		// just "Successfully replaced N block(s)" — the actual diff lives
		// in `details.patch`). This shows the same data the native Pi
		// expand would show.
		const details = entry.details as { patch?: string } | undefined;
		if (typeof details?.patch === "string" && details.patch.length > 0) {
			items.push(...renderPatchLines(details.patch, theme));
		}
	}

	// Tail-cap the total so the most recent entries (which usually
	// matter most — bash errors land at the bottom, the latest read is
	// what the LLM just consumed) stay visible. The cap is the user's
	// `expandedBodyMaxLines` config (default 200; pre-plan this was
	// `EXPANDED_BODY_MAX_LINES * 4`, which had the same numeric value).
	const cap = config.expandedBodyMaxLines;
	const total = items.length;
	const showItems = total > cap ? items.slice(-cap) : items;

	const c = container as Container;
	c.clear();
	for (const item of showItems) {
		c.addChild(new Text(`${item.prefix}${item.text}`, 0, 0));
	}
	if (total > cap) {
		const remaining = total - cap;
		c.addChild(
			new Text(
				`${BODY_PREFIX}${theme.fg(
					"dim",
					`… ${remaining} earlier line${remaining === 1 ? "" : "s"} not shown`,
				)}`,
				0,
				0,
			),
		);
	}
	if (!isLatest) {
		c.addChild(
			new Text(
				`${BODY_PREFIX}${theme.fg("dim", "earlier in group · see the latest below")}`,
				0,
				0,
			),
		);
	} else if (count > 1) {
		c.addChild(
			new Text(
				`${BODY_PREFIX}${theme.fg("dim", `${count} calls in this group`)}`,
				0,
				0,
			),
		);
	}
	return container;
}

export function friendlyLabel(toolName: string): string {
	if (toolName === "bash") return "Shell";
	const map: Record<string, string> = {
		read: "Read",
		edit: "Edit",
		write: "Write",
		ls: "Ls",
		grep: "Grep",
		find: "Find",
	};
	return map[toolName] ?? toolName;
}

export function argSummaryFor(
	toolName: string,
	args: unknown,
	cwd: string,
): string {
	if (!args || typeof args !== "object") return "";
	const a = args as Record<string, unknown>;
	const get = (key: string): unknown => a[key];
	// `file_path` is the Codex-style alias for `path` on the file tools
	// (see the SDK's `formatReadCall` / `formatWriteCall` /
	// `formatEditCall` in `dist/core/tools/*.js`, all of which read
	// `args?.file_path ?? args?.path`). Accept both so the spinner
	// summary stays correct for Codex-shaped invocations as well.
	const getPath = (): string => String(get("path") ?? get("file_path") ?? "");
	switch (toolName) {
		case "bash":
			return shortCommand(cwd, String(get("command") ?? ""));
		case "read":
		case "edit":
		case "write":
			return relPath(cwd, getPath());
		case "ls":
			return relPath(cwd, getPath() || ".");
		case "grep":
		case "find":
			return String(get("pattern") ?? "");
		default:
			return "";
	}
}

export function overrideBash(
	grouping: GroupingSession,
	config: MinimalToolcallConfig = DEFAULT_MINIMAL_TOOLCALL_CONFIG,
): AnyToolDef {
	return makeOverride(
		(cwd) => createBashToolDefinition(cwd) as AnyToolDef,
		grouping,
		config,
	);
}

export function overrideRead(
	grouping: GroupingSession,
	config: MinimalToolcallConfig = DEFAULT_MINIMAL_TOOLCALL_CONFIG,
): AnyToolDef {
	return makeOverride(
		(cwd) => createReadToolDefinition(cwd) as AnyToolDef,
		grouping,
		config,
	);
}

export function overrideEdit(
	grouping: GroupingSession,
	config: MinimalToolcallConfig = DEFAULT_MINIMAL_TOOLCALL_CONFIG,
): AnyToolDef {
	return makeOverride(
		(cwd) => createEditToolDefinition(cwd) as AnyToolDef,
		grouping,
		config,
	);
}

export function overrideWrite(
	grouping: GroupingSession,
	config: MinimalToolcallConfig = DEFAULT_MINIMAL_TOOLCALL_CONFIG,
): AnyToolDef {
	return makeOverride(
		(cwd) => createWriteToolDefinition(cwd) as AnyToolDef,
		grouping,
		config,
	);
}

export function overrideGrep(
	grouping: GroupingSession,
	config: MinimalToolcallConfig = DEFAULT_MINIMAL_TOOLCALL_CONFIG,
): AnyToolDef {
	return makeOverride(
		(cwd) => createGrepToolDefinition(cwd) as AnyToolDef,
		grouping,
		config,
	);
}

export function overrideFind(
	grouping: GroupingSession,
	config: MinimalToolcallConfig = DEFAULT_MINIMAL_TOOLCALL_CONFIG,
): AnyToolDef {
	return makeOverride(
		(cwd) => createFindToolDefinition(cwd) as AnyToolDef,
		grouping,
		config,
	);
}

export function overrideLs(grouping: GroupingSession): AnyToolDef {
	return makeOverride(
		(cwd) => createLsToolDefinition(cwd) as AnyToolDef,
		grouping,
	);
}
