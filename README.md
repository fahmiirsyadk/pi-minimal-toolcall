# @whitespace/pi-minimal-toolcall

Minimal tool call rendering for Pi: one row per group of consecutive same-tool calls, paths relativized, no background box, calm indicator, collapsed thinking. Press `ctrl+o` to expand a row inline and see the full output; press again to collapse.

## What it does

Overrides Pi's built-in tools (`bash`, `read`, `edit`, `write`, `grep`, `find`, `ls`) with a minimal `renderShell: "self"` renderer that groups consecutive same-tool calls into a single row that updates in place. Also folds in the calm UI defaults that used to live in `@whitespace/pi-quiet-ui`:

- Working indicator suppressed
- Tool output collapsed by default
- Thinking hidden behind a single `thinking` label

When the model calls the same tool multiple times in a row, the chat shows one row per group. The row updates its count and replaces its arg with the most recent one as each call lands, so the summary never grows beyond one line:

```text
  ⠋ Read 1 file (packages/foo.ts)                                       ctrl+o to expand
  Edit 2 files (README.md) +5 -3                                        ctrl+o to expand
  Write 1 file (scroll-preserve.md) +120                                ctrl+o to expand
  shell 2 commands (cd ./packages/pi-minimal-toolcall && biome check --write .)   ctrl+o to expand
```

The count ticks up and the latest arg replaces the previous one. A different tool starts a new row and the previous row finalizes. The grouping is consecutive per tool name — a run of the same tool accumulates into one group, and a different tool cuts the group and starts a new one. So `read` → `read` → `read` shows one row that updates from `Read 1 file` to `Read 2 files` to `Read 3 files`, while `read` → `bash` → `read` shows three visible rows (`Read 2 files`, `Shell 1 command`, `Read 1 file`). The count reflects the consecutive run, not the whole session.

While a tool is running, the row shows an animated Braille spinner (`⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏`) in the same `label + count + noun (arg)` shape as the end result, so the user sees the final structure immediately. When the result lands, the spinner is replaced by the group summary. For `edit` and `write`, the summary appends `+N -M` diff net lines beside the path — parsed from the unified patch (`edit`) or computed from the pre-execution file content captured in `renderCall` (`write`).

- No background box (uses `renderShell: "self"`); 2 spaces of left padding give the tool block visual separation from the chat message above it
- Paths relativized against the live `cwd` at execution time (`/home/user/.../packages` → `packages`)
- Bash commands with embedded cwd paths are also relativized

### `ctrl+o` expands inline

Pressing `ctrl+o` on a tool row expands it inline. The row grows from one line to a `Container` with the tool's full output. Press `ctrl+o` again to collapse. There is no modal: the expanded content sits in the chat, with rows above and below still visible. Multiple rows can be expanded at once.

For a grouped row, the expanded view shows **every call in the group**, not just the most recent: each call gets its own header (`✓`/`✗` + arg + diff + duration) followed by its text output AND its diff patch (for `edit`, the full unified diff from `details.patch` is rendered with `+`/`-` coloring — the text alone is just "Successfully replaced N block(s)"). The combined body is tail-capped at 200 lines so a huge group does not flood the TUI; a `… N earlier lines not shown` footer notes the truncation. The footer says `N calls in this group` for groups of 2+. Per-call timing (e.g. `1.2s`, `500ms`) is shown in each entry's header, matching the SDK bash's `Took` format. If a new same-tool call lands while a row is expanded, the previous row's expanded view is preserved (rebuilt from the group's stored results) with an `earlier in group · see the latest below` footer instead of being silently collapsed.

Note: expanding a tool row whose position is above the visible viewport triggers a full TUI re-render that clears terminal scrollback (`\x1b[3J`) and snaps the viewport to the bottom. To preserve scrollback in that case, install [`@whitespace/pi-preserve-scroll`](https://github.com/whitespace/pi-stuff/tree/main/packages/pi-preserve-scroll) alongside this package — it ships the TUI patch.

## Batch tools

Registers four batch tools that the model can call instead of repeating the built-ins. Each renders as one row; `ctrl+o` expands inline to per-item `✓`/`✗` status + aggregated output:

- `read_files({ paths, offset?, limit? })` — read 2+ files in one call
- `edit_files({ edits: [{ path, oldText, newText }] })` — edit multiple files in one call
- `grep_files({ queries: [{ pattern, path?, ... }] })` — multiple grep searches in one call
- `find_files({ queries: [{ pattern, path?, limit? }] })` — multiple find searches in one call

Partial failures are surfaced per-item (`✗ path <error>`); the whole batch throws only if every item fails. Per-item execution uses the built-in tool definitions with the live `ctx.cwd`.

Batch tools are not grouped further (they are already a single call). The chat shows one row per batch call. While a batch is in flight, the row shows a spinner in the same `label + count + noun` shape as the end result (`⠋ Read 3 files`, `⠋ Edit 2 files`, `⠋ Grep 3 searches`, `⠋ Find 1 search`) for the whole run — partial `onUpdate` ticks (one item finished inside the batch) keep the spinner alive and return a stable 0-line result Text instead of allocating per item. The collapsed summary (`Read 4 files`, `Edit 2 files`, `Grep 3 searches`, `Find 1 search`) replaces the spinner once the final result lands.

## Install

```bash
pi install npm:@whitespace/pi-minimal-toolcall
```

One-off:

```bash
pi -e npm:@whitespace/pi-minimal-toolcall
```

## Compatibility with other extensions

- **Scroll preservation is opt-in.** This package does not ship the TUI patch; install [`@whitespace/pi-preserve-scroll`](https://github.com/whitespace/pi-stuff/tree/main/packages/pi-preserve-scroll) if you want terminal scrollback preserved when expanding a tool row above the visible viewport.
- **Other extensions calling `setToolsExpanded`** are unaffected — this package only changes the renderer, not when `setToolsExpanded` fires.
- **Other tools registered by other extensions** are not part of the grouping. They render with their own renderer. If a group mixes our tools and another extension's tool, the other tool's row shows its own rendering and breaks the group.

## Development

```bash
bun install
bun run check
bun run pack:dry
```
