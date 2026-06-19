import type { Theme } from "@earendil-works/pi-coding-agent";
import { keyHint } from "@earendil-works/pi-coding-agent";
import {
	argSummaryFor,
	extractOutput,
	friendlyLabel,
} from "./tool-overrides.js";

/**
 * Net diff line counts for an edit/write entry. Aggregated across a
 * group for the collapsed summary; formatted per-entry in the expanded
 * view. Reads / bash / ls / grep / find contribute nothing.
 */
export interface DiffInfo {
	added: number;
	removed: number;
}

/**
 * One entry in a tool-call group. **Proximity grouping**: a run of tool
 * calls with NO text or thinking block between them accumulates into one
 * group, regardless of tool name. A text or thinking block (or a new
 * agent loop) freezes the current group; the next tool call starts a
 * fresh one. This keeps a group's single row at the position where its
 * calls actually ran, instead of same-tool calls compounding and
 * shifting across text/thinking (the old flaw: `shell, shell` →
 * `Shell 2`, then thinking, then `shell` joined the pre-thinking group
 * → `Shell 3` rendered at the bottom, so the earlier shells visually
 * "shifted" below the thinking). Only the last entry in each group
 * renders the summary; earlier entries collapse to a 0-line `Text`.
 * Each entry's `output` / `isError` / `diffInfo` / `details` are filled
 * in by `storeResult` when the entry's final result lands, so the
 * expanded view can render every call in the group, not just the most
 * recent.
 */
export interface GroupEntry {
	toolCallId: string;
	toolName: string;
	args: unknown;
	/**
	 * Invalidate hook for the `ToolExecutionComponent` rendering this entry.
	 * Calling it re-runs `updateDisplay` → `renderResult` with the current
	 * group state. Registered by the renderer via `registerInvalidate`.
	 */
	invalidate?: () => void;
	/** Extracted text output, set by `storeResult` on the final result. */
	output?: string;
	/** Whether this entry's result was an error. */
	isError?: boolean;
	/** Net diff lines (edit/write). Aggregated for the collapsed summary,
	 * formatted per-entry in the expanded view. */
	diffInfo?: DiffInfo;
	/** Wall-clock time the tool started (`Date.now()` at `onToolExecutionStart`). */
	startedAt: number;
	/** How long the tool took, in ms (`Date.now() - startedAt` at `storeResult`). */
	durationMs?: number;
	/** Raw result details (e.g. `EditToolDetails.patch`, `BashToolDetails.truncation`).
	 * Stored so the expanded view can render the full diff / truncation info,
	 * not just the text content. */
	details?: unknown;
}

/**
 * A proximity group: a run of tool calls with no text/thinking between
 * them. Mixed tool names are intended — `read, read, bash` becomes one
 * group summarized as `Read 2 files & Shell 1 command`.
 */
export interface CurrentGroup {
	entries: GroupEntry[];
}

/**
 * Per-session handle for tool-call grouping. Created by
 * `createGroupingSession()` once per `session_start`; all grouping state
 * is held in the returned object's closure, never in module-level
 * variables. This keeps concurrent or sequentially-replaced sessions in
 * the same process from corrupting each other's group state.
 */
export interface GroupingSession {
	/**
	 * Adds a new tool entry to the current group if one is open,
	 * otherwise starts a new one. A group is frozen (set to null) by
	 * `freezeCurrentGroup` when a text or thinking block appears between
	 * tool calls, or when a new agent loop starts — NOT by a change in
	 * tool name. Pushing the new entry invalidates the previous entry in
	 * the same group so it collapses to 0-line. Idempotent for duplicate
	 * start events on the same `toolCallId`.
	 */
	onToolExecutionStart(event: {
		toolCallId: string;
		toolName: string;
		args: unknown;
	}): void;
	/** True when `toolCallId` is the last entry in its group (the one
	 * that renders the summary). False for earlier entries in any group. */
	isGroupLatest(toolCallId: string): boolean;
	/** Register the `invalidate` hook from the renderer. */
	registerInvalidate(toolCallId: string, invalidate: () => void): void;
	/**
	 * Resolve the group to render for a given `toolCallId`, or the
	 * currently-active group when no id is given.
	 */
	getCurrentGroup(toolCallId?: string): CurrentGroup | null;
	/** Store an entry's final result so the expanded view can render it.
	 * Called from `renderResult` on the final (non-partial) result. */
	storeResult(
		toolCallId: string,
		result: {
			content: Array<{ type: string; text?: string }>;
			details?: unknown;
		},
		isError: boolean,
		diffInfo?: DiffInfo,
	): void;
	/** Render the `<Friendly> <count> <noun>[ & <Friendly> <count> <noun>] (arg) [+N -M] [✗] ctrl+o to expand` summary line. */
	renderGroupSummary(group: CurrentGroup, theme: Theme, cwd: string): string;
	/**
	 * Freeze the currently-accumulating group so the next tool call
	 * starts a fresh group. Call when a text or thinking block appears
	 * between tool calls (so calls separated by prose/thinking do not
	 * merge), and at the start of a new agent loop (one per user prompt)
	 * so a run that ends on `bash` and a later prompt that also starts
	 * with `bash` do not compound across the user's turn.
	 * Already-finished groups stay in `entryToGroup` for lookups.
	 */
	freezeCurrentGroup(): void;
}

/**
 * Build a fresh `GroupingSession`. Call once per `session_start` and
 * thread the result through the override renderers for that session.
 */
export function createGroupingSession(): GroupingSession {
	// The currently-accumulating group. Frozen to `null` by
	// `freezeCurrentGroup` when text/thinking appears between tool calls
	// or a new agent loop starts; the next tool call opens a fresh group.
	let currentGroup: CurrentGroup | null = null;
	// Reverse index: toolCallId → its group. Used for O(1) lookups in
	// `isGroupLatest`, `getCurrentGroup(toolCallId)`, and `storeResult`.
	const entryToGroup = new Map<string, CurrentGroup>();

	const onToolExecutionStart = (event: {
		toolCallId: string;
		toolName: string;
		args: unknown;
	}): void => {
		if (entryToGroup.has(event.toolCallId)) return;
		// Proximity grouping: a new tool call joins the current group if
		// one is open, regardless of tool name. Mixing tools in one group
		// is intended — `read, read, bash` with nothing between becomes
		// one row `Read 2 files & Shell 1 command`. The group is frozen
		// only by a text/thinking block or a new agent loop.
		if (!currentGroup) {
			currentGroup = { entries: [] };
		}
		// Push the new entry first so the group state is up to date when
		// the previous entry re-renders. If we invalidated before pushing,
		// the previous entry would still see itself as "latest" against
		// the old state, return the same Text it already had cached, and
		// the TUI diff would see no change — the row would never collapse.
		const prev = currentGroup.entries.at(-1);
		currentGroup.entries.push({
			toolCallId: event.toolCallId,
			toolName: event.toolName,
			args: event.args,
			startedAt: Date.now(),
		});
		entryToGroup.set(event.toolCallId, currentGroup);
		// Invalidate the previous entry in the same group so it collapses
		// (it is no longer the latest). Cross-group invalidation does not
		// happen here — a frozen group's last entry keeps its summary.
		prev?.invalidate?.();
	};

	const registerInvalidate = (
		toolCallId: string,
		invalidate: () => void,
	): void => {
		const group = entryToGroup.get(toolCallId);
		if (!group) return;
		const entry = group.entries.find((e) => e.toolCallId === toolCallId);
		if (entry) entry.invalidate = invalidate;
	};

	const isGroupLatest = (toolCallId: string): boolean => {
		const group = entryToGroup.get(toolCallId);
		if (!group) return true;
		const last = group.entries.at(-1);
		if (!last) return true;
		return last.toolCallId === toolCallId;
	};

	const getCurrentGroup = (toolCallId?: string): CurrentGroup | null => {
		if (toolCallId) {
			return entryToGroup.get(toolCallId) ?? null;
		}
		return currentGroup;
	};

	const storeResult = (
		toolCallId: string,
		result: {
			content: Array<{ type: string; text?: string }>;
			details?: unknown;
		},
		isError: boolean,
		diffInfo?: DiffInfo,
	): void => {
		const group = entryToGroup.get(toolCallId);
		if (!group) return;
		const entry = group.entries.find((e) => e.toolCallId === toolCallId);
		if (!entry) return;
		entry.output = extractOutput(result);
		entry.isError = isError;
		if (diffInfo) entry.diffInfo = diffInfo;
		entry.durationMs = Date.now() - entry.startedAt;
		entry.details = result.details;
	};

	return {
		onToolExecutionStart,
		isGroupLatest,
		registerInvalidate,
		getCurrentGroup,
		storeResult,
		renderGroupSummary,
		freezeCurrentGroup: () => {
			currentGroup = null;
		},
	};
}

/**
 * Render the shared multi-tool title core used by the collapsed summary,
 * the expanded header, and the live spinner. Format:
 *   `<Friendly> <count> <noun>[ ✗][ & <Friendly> <count> <noun>[ ✗]]`
 * Tools appear in the order of their first call within the group. Each
 * tool's friendly label is colored `labelColor` (`"dim"` for the resting
 * summary, `"accent"` for the spinner and expanded header); the
 * `count noun` part is `text`-colored. A tool that has any errored entry
 * gets a ` ✗` after its count. The `&` separators are `dim`.
 */
export function renderGroupTitleCore(
	group: CurrentGroup,
	theme: Theme,
	labelColor: "dim" | "accent",
): string {
	const { entries } = group;
	const order: string[] = [];
	const counts = new Map<string, number>();
	const errored = new Set<string>();
	for (const e of entries) {
		if (!counts.has(e.toolName)) {
			order.push(e.toolName);
			counts.set(e.toolName, 0);
		}
		counts.set(e.toolName, (counts.get(e.toolName) ?? 0) + 1);
		if (e.isError) errored.add(e.toolName);
	}
	const sep = theme.fg("dim", "&");
	const parts = order.map((toolName) => {
		const count = counts.get(toolName) ?? 0;
		const label = friendlyLabel(toolName);
		const noun = nounFor(toolName, count);
		const mark = errored.has(toolName) ? ` ${theme.fg("error", "✗")}` : "";
		return `${theme.fg(labelColor, label)} ${theme.fg("text", `${count} ${noun}`)}${mark}`;
	});
	return parts.join(` ${sep} `);
}

/** Format net diff lines as a colored suffix: ` +5 -3` (leading space,
 * success-colored added, error-colored removed). Empty when both are 0. */
export function formatDiffSuffix(info: DiffInfo, theme: Theme): string {
	const parts: string[] = [];
	if (info.added > 0) parts.push(theme.fg("success", `+${info.added}`));
	if (info.removed > 0) parts.push(theme.fg("error", `-${info.removed}`));
	return parts.length > 0 ? ` ${parts.join(" ")}` : "";
}

/**
 * Render the group summary line. Format:
 *   <title-core> [(latest arg)] [+N -M] [ctrl+o to expand]
 * The `(latest arg)` is shown only for single-tool groups (a multi-tool
 * line is already busy; paths would be noise). `+N -M` is the net diff
 * aggregated across every edit/write entry in the group (reads/bash
 * contribute nothing). `cwd` relativizes the single-tool arg.
 */
function renderGroupSummary(
	group: CurrentGroup,
	theme: Theme,
	cwd: string,
): string {
	const { entries } = group;
	const distinctTools = new Set(entries.map((e) => e.toolName));
	const isSingle = distinctTools.size === 1;
	const core = renderGroupTitleCore(group, theme, "dim");
	// Aggregate net diff across all edit/write entries.
	let added = 0;
	let removed = 0;
	for (const e of entries) {
		if (e.diffInfo) {
			added += e.diffInfo.added;
			removed += e.diffInfo.removed;
		}
	}
	const diffSuffix =
		added > 0 || removed > 0 ? formatDiffSuffix({ added, removed }, theme) : "";
	let argSuffix = "";
	if (isSingle) {
		const latest = entries.at(-1);
		const arg = latest ? argSummaryFor(latest.toolName, latest.args, cwd) : "";
		argSuffix = arg ? theme.fg("muted", ` (${arg})`) : "";
	}
	const hint = theme.fg("dim", " ") + keyHint("app.tools.expand", "to expand");
	return `${LEFT_PADDING}${core}${argSuffix}${diffSuffix}${hint}`;
}

/** Left padding for tool call rows. `renderShell: "self"` strips the
 * default TUI background box and left border, so the tool block would
 * otherwise sit flush against the chat message above it. A single
 * space of leading padding gives the minimum visual separation while
 * keeping the calm borderless look. The SDK already prepends a blank
 * line above each tool block as a visual separator, so we do not add
 * a second visual mark (no `└` branch anchor): one separator, not two. */
export const LEFT_PADDING = " ";

/** Indent for body content inside an expanded tool view (body lines,
 * per-item status rows, truncation footers, group-count footers).
 * One space matches the call row's `LEFT_PADDING` so the body content
 * reads as a continuation of the same block, not as a separate
 * sub-block. */
export const BODY_PREFIX = " ";

export function nounFor(toolName: string, count: number): string {
	const singular: Record<string, string> = {
		bash: "command",
		read: "file",
		edit: "file",
		write: "file",
		ls: "dir",
		grep: "search",
		find: "search",
	};
	const plural: Record<string, string> = {
		bash: "commands",
		read: "files",
		edit: "files",
		write: "files",
		ls: "dirs",
		grep: "searches",
		find: "searches",
	};
	return count === 1
		? (singular[toolName] ?? "item")
		: (plural[toolName] ?? "items");
}
