/**
 * Single source of truth for the per-tool display metadata used by the
 * collapsed summary, the expanded view, and the live spinner:
 *
 * - `label` — the friendly tool name shown to the user (`bash` → `Shell`).
 * - `singular` — the noun for one call (`bash` → `command`).
 * - `plural` — the noun for many calls (`bash` → `commands`).
 *
 * Adding a new built-in tool means adding a single entry here. The
 * `friendlyLabel` and `nounFor` helpers in this package become thin
 * wrappers (or get inlined at the call sites) so the three lookups
 * can no longer drift.
 *
 * Batch tools (`read_files`, `edit_files`, `grep_files`, `find_files`)
 * share labels + nouns with their single-call counterparts; the
 * expanded view's per-item ✓/✗ list makes the batch shape clear.
 */
export interface ToolDisplay {
	label: string;
	singular: string;
	plural: string;
}

export const TOOL_DISPLAY: Record<string, ToolDisplay> = {
	bash: { label: "Shell", singular: "command", plural: "commands" },
	read: { label: "Read", singular: "file", plural: "files" },
	read_files: { label: "Read", singular: "file", plural: "files" },
	edit: { label: "Edit", singular: "file", plural: "files" },
	edit_files: { label: "Edit", singular: "file", plural: "files" },
	write: { label: "Write", singular: "file", plural: "files" },
	ls: { label: "Ls", singular: "dir", plural: "dirs" },
	grep: { label: "Grep", singular: "search", plural: "searches" },
	grep_files: { label: "Grep", singular: "search", plural: "searches" },
	find: { label: "Find", singular: "search", plural: "searches" },
	find_files: { label: "Find", singular: "search", plural: "searches" },
};

/** Resolve the friendly label for a tool name. Falls back to the
 *  raw tool name when no entry is registered (lets a freshly-added
 *  custom tool still render without crashing). */
export function friendlyLabel(toolName: string): string {
	return TOOL_DISPLAY[toolName]?.label ?? toolName;
}

/** Resolve the count noun for a tool name. `count === 1` returns the
 *  singular form; anything else returns the plural form. Unregistered
 *  tools fall back to `item` / `items`. */
export function nounFor(toolName: string, count: number): string {
	const entry = TOOL_DISPLAY[toolName];
	if (!entry) return count === 1 ? "item" : "items";
	return count === 1 ? entry.singular : entry.plural;
}
