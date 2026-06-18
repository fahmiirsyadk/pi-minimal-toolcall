import type { Theme } from "@earendil-works/pi-coding-agent";
import { keyHint } from "@earendil-works/pi-coding-agent";
import {
	argSummaryFor,
	extractOutput,
	friendlyLabel,
} from "./tool-overrides.js";

/**
 * One entry in a tool-call group. Consecutive grouping: a run of the
 * same tool name accumulates into one group; a different tool name
 * freezes the current group and starts a new one. Only the last entry
 * in each group renders the summary; earlier entries collapse to a
 * 0-line `Text`. Each entry's `output` / `isError` / `diffSuffix` are
 * filled in by `storeResult` when the entry's final result lands, so
 * the expanded view can render every call in the group, not just the
 * most recent.
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
	/** Pre-formatted, theme-colored diff suffix (e.g. ` +5 -3`). */
	diffSuffix?: string;
	/** Wall-clock time the tool started (`Date.now()` at `onToolExecutionStart`). */
	startedAt: number;
	/** How long the tool took, in ms (`Date.now() - startedAt` at `storeResult`). */
	durationMs?: number;
	/** Raw result details (e.g. `EditToolDetails.patch`, `BashToolDetails.truncation`).
	 * Stored so the expanded view can render the full diff / truncation info,
	 * not just the text content. */
	details?: unknown;
}

interface CurrentGroup {
	toolName: string;
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
	 * Adds a new tool entry to the current group if its tool name
	 * matches, otherwise freezes the current group and starts a new
	 * one. Freezing leaves the previous group's latest entry visible
	 * (its summary is not invalidated); only the previous entry
	 * *within the same group* is invalidated so it collapses. Idempotent
	 * for duplicate start events on the same `toolCallId`.
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
		diffSuffix?: string,
	): void;
	/** Render the `<friendly> <count> <noun> (latest arg) [+N -M] [✗]` summary line. */
	renderGroupSummary(
		group: CurrentGroup,
		theme: Theme,
		cwd: string,
		diffSuffix?: string,
		isError?: boolean,
	): string;
}

/**
 * Build a fresh `GroupingSession`. Call once per `session_start` and
 * thread the result through the override renderers for that session.
 */
export function createGroupingSession(): GroupingSession {
	// The currently-accumulating group. A different tool name freezes
	// this (it stays in `entryToGroup` for lookups but no new entries
	// are added) and replaces it with a fresh group. This is
	// *consecutive* grouping: `read → read → bash → read` produces
	// three groups (`read` x2, `bash` x1, `read` x1) and three visible
	// rows, not a single `read` row that grows to 3 across the bash.
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
		// Consecutive grouping: a different tool name starts a new
		// group and freezes the previous one. The previous group's
		// latest entry keeps its summary (it is not invalidated here —
		// only the previous entry *within the same group* collapses).
		if (!currentGroup || currentGroup.toolName !== event.toolName) {
			currentGroup = { toolName: event.toolName, entries: [] };
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
		// Only invalidate within the same group: the previous entry
		// collapses (it is no longer the latest in this group).
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
		diffSuffix?: string,
	): void => {
		const group = entryToGroup.get(toolCallId);
		if (!group) return;
		const entry = group.entries.find((e) => e.toolCallId === toolCallId);
		if (!entry) return;
		entry.output = extractOutput(result);
		entry.isError = isError;
		if (diffSuffix !== undefined) entry.diffSuffix = diffSuffix;
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
	};
}

/**
 * Render the group summary line. Format:
 *   <friendly> <count> <noun> (latest arg) [+N -M] [✗] [ctrl+o to expand]
 * `diffSuffix` is an already-formatted, theme-colored diff string (e.g.
 * ` +5 -3`) that is appended after the arg summary when present. `cwd` is
 * used to relativize paths and shorten commands. `isError` adds a ` ✗`
 * mark after the noun so a failed tool call is visible without expanding.
 */
function renderGroupSummary(
	group: CurrentGroup,
	theme: Theme,
	cwd: string,
	diffSuffix?: string,
	isError?: boolean,
): string {
	const { toolName, entries } = group;
	const count = entries.length;
	const friendly = friendlyLabel(toolName);
	const noun = nounFor(toolName, count);
	// Show only the most recent arg in the summary. The count conveys "we
	// ran N of these" without accumulating every path/command into a
	// wrapping wall of text. Earlier entries are still collapsed to 0
	// lines, so the chat shows one row per group that updates in place:
	// the count ticks up and the latest arg replaces the previous one.
	const latest = entries.at(-1);
	const argSummary = latest ? argSummaryFor(toolName, latest.args, cwd) : "";
	const statusMark = isError ? ` ${theme.fg("error", "✗")}` : "";
	const head = `${theme.fg("dim", friendly)} ${theme.fg("text", `${count} ${noun}`)}${statusMark}`;
	const tail = argSummary ? theme.fg("muted", ` (${argSummary})`) : "";
	const diff = diffSuffix ?? "";
	const hint = theme.fg("dim", " ") + keyHint("app.tools.expand", "to expand");
	return `${LEFT_PADDING}${head}${tail}${diff}${hint}`;
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
