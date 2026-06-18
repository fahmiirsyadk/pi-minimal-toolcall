# pi-minimal-toolcall — Roadmap

Current state and planned improvements for the minimal tool call renderer.

## Current

- **One row per group of consecutive same-tool calls.** Groups update in place: as more calls land, the count ticks up and the most recent arg replaces the previous one on the same row (no comma-accumulated arg wall). A different tool name cuts the group and starts a new one, so the count reflects the consecutive run, not the whole session. Implementation: `src/grouping.ts` tracks execution order via `tool_execution_start`, keeping a single `currentGroup` that is frozen (not invalidated) when a different tool arrives; `src/tool-overrides.ts` renders 0 lines for all entries except the last in their group (`isGroupLatest`) and a 1-line group summary for the last.
- `renderShell: "self"` — no background box, tight padding
- Relative paths against the live `cwd` at execution time (bash: regex-anchored path-token replacement; read/edit/write/grep/find/ls: strip cwd prefix). Execution and rendering use `ctx.cwd` / `context.cwd`, not a `session_start`-captured cwd.
- **Native inline expand on `ctrl+o`.** The row grows from a one-line summary to a `Container` that renders **every call in the group**: a per-entry header (`✓`/`✗` + arg + diff) followed by that entry's output. The combined body is tail-capped at `EXPANDED_BODY_MAX_LINES * 4` (200) lines; longer output shows a `… N earlier lines not shown` footer. Each entry's `output` / `isError` / `diffSuffix` are stored on the group via `storeResult` when the final result lands, so `write`'s `+N -M` diff is visible per-entry. Press `ctrl+o` again to collapse. Multiple rows can be expanded at once. No modal, no popup.
- **Per-session grouping state**, keyed by `ctx.sessionManager.getSessionId()`. A future multi-session process won't leak group state between sessions.
- **Calm UI defaults** (folded in from the removed `@whitespace/pi-quiet-ui`): working indicator suppressed, tools collapsed by default, thinking hidden behind a single `thinking` label. Users can still expand with `ctrl+o` / `ctrl+t`.
- Batch tools: `read_files`, `edit_files`, `grep_files`, `find_files` group multiple built-in calls into one rendered block. Collapsed: one summary line. Expanded (on `ctrl+o`): per-item `✓`/`✗` status + aggregated output in a `Container`. Partial failures surface per-item; the batch throws only if every item fails. Each item runs the built-in tool definition with the live `ctx.cwd`. Batch tools are not grouped further (they are already a single call).

## Done: drop the floating-overlay expand

Pi's built-in `setToolsExpanded` toggles every expandable chat row and calls `requestRender()`. The TUI's `doRender` diffs old vs new lines; when a toggle changes any line count above the visible viewport, it falls into the `firstChanged < prevViewportTop` branch and runs `fullRender(true)`, which emits `\x1b[3J` (clears scrollback) and snaps the terminal viewport to the bottom. No public scroll save/restore API exists; the TUI does not track the user's terminal-native scroll position.

Shipped: native inline expand. `renderResult` returns a `Container` (header + body + footer) when `options.expanded` is true, matching the `pi-explore-subagents` native-expand pattern. `ctrl+o` drives the built-in `setToolsExpanded`; no `onTerminalInput` intercept, no modal. Multiple rows can be expanded at once. Body is capped at 50 lines; longer output shows a `… N more lines` footer. The earlier `ctx.ui.custom` overlay (`src/tool-overlay.ts`) has been removed.

The scrollback wipe on expand-above-viewport is accepted as the default for this package. Users who want scroll preservation in that case install [`@whitespace/pi-preserve-scroll`](https://github.com/whitespace/pi-stuff/tree/main/packages/pi-preserve-scroll), which ships the TUI patch. The right long-term fix is an upstream `setToolsExpanded({ scrollTo: "row" })` API that knows the user's scroll position.

## Done: group consecutive same-tool calls

Two layers, one display-level and one model-level:

**Display-level grouping (chat rows, 0.2.0):** `src/grouping.ts` tracks the order of `tool_execution_start` events. `src/tool-overrides.ts` returns a 0-line `Text` for every entry in the current group except the last, which returns a 1-line summary with the cumulative count and the **most recent arg** (no comma-accumulated list). As more same-tool calls land, the previous "last" entry collapses (its renderer re-runs after Pi's `requestRender` following `tool_execution_start` and finds it is no longer the last), and the new entry becomes the visible summary. Switching tool name starts a new group. This solves the "chat populated with one row per tool" problem without merging children in the chat container (which the extension layer cannot do). Group state is held in a per-session `GroupingSession` keyed by `ctx.sessionManager.getSessionId()`, so a future multi-session process cannot leak group state between sessions.

**Model-level grouping (LLM context, 0.1.0):** `src/batch-tools.ts` registers `read_files`/`edit_files`/`grep_files`/`find_files`. The model calls these instead of repeating the built-ins, so the LLM sees one aggregated `tool_result` per logical operation. The chat shows one row per batch call (no further grouping needed).

Earlier Option B (post-hoc grouping via `tool_execution_start`/`end`) and Option C (`registerMessageRenderer`) were rejected: B can't rewrite already-rendered rows from the extension layer (no cross-row `invalidate` API) and doesn't reduce LLM context; C doesn't apply because tool results are rendered by `ToolExecutionComponent`, not the message renderer. Option D (display-level grouping by collapsing earlier entries in a group to 0-line `Text`) was not considered when the original roadmap was written; it is what shipped in 0.2.0.

Reference pattern: `references/howaboua-pi-stuff/packages/pi-explore-subagents/src/render.ts`.

## Future: configurable output styles

- `/toolcall style minimal|verbose|default` — preset for collapse/expand
- Per-tool config: which tools to group, which to show inline
- Configurable expanded cap (currently 50 lines)
- Cycle through grouped entries with `2` (show the earlier call in a group when expanded)
- Navigate between expandable rows with `j`/`k` without expanding
- A separate full-screen viewer (like the old overlay) for the rare case of truly huge output that exceeds the terminal-height cap

## Known issues

- **Expand above the visible viewport wipes terminal scrollback.** The TUI's `firstChanged < prevViewportTop` branch runs `fullRender(true)` which clears scrollback and snaps the viewport to the bottom. Install [`@whitespace/pi-preserve-scroll`](https://github.com/whitespace/pi-stuff/tree/main/packages/pi-preserve-scroll) to mitigate.
- **Header compact banner still says "press ctrl+o for full help."** With the native expand, `ctrl+o` on the header expands the header; on a tool row, it expands the tool row. The hint is now consistent (both expand), but the wording is generic. Not a blocker.
- **No public scroll save/restore API in `@earendil-works/pi-tui`**: `previousViewportTop`, `previousHeight`, `previousWidth`, and `doRender` are all private. The TUI does not track the user's terminal-native scroll position, so any content change above its internal "bottom of buffer" viewport still triggers a full re-render. An upstream `setToolsExpanded({ scrollTo: "row" })` API would fix this.
