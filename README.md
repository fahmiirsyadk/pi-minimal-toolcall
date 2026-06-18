# @whitespace/pi-minimal-toolcall

A calmer, more compact tool-call view for [Pi](https://github.com/earendil-works/pi-coding-agent). Replaces Pi's default per-call tool blocks with one quiet row per group of consecutive same-tool calls, relative paths, no background box, and collapsed thinking. Press `ctrl+o` to expand any row inline.

```
  ⠋ Read 3 files (src/grouping.ts)                              ctrl+o to expand
  Edit 2 files (README.md) +5 -3                                ctrl+o to expand
  Write 1 file (scroll-preserve.md) +120                        ctrl+o to expand
  shell 2 commands (cd ./packages && biome check --write .)     ctrl+o to expand
  thinking
```

## Features

### One row per group

When the model calls the same tool several times in a row, those calls collapse into a **single row that updates in place** instead of producing one block per call. The count ticks up and the latest argument replaces the previous one, so a 10-call `read` run is still just one line:

```
  Read 10 files (src/batch-tools.ts)                            ctrl+o to expand
```

A different tool name cuts the group and starts a new one, so the count always reflects the current consecutive run, not the whole session. `read → read → read` renders as one row; `read → bash → read` renders as three.

### Live spinner

While a call is in flight, the row shows an animated Braille spinner (`⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏`) in the same `label + count + noun (arg)` shape as the final summary, so you see the final structure immediately. When the result lands, the spinner is replaced by the group summary.

### Diff net lines

For `edit` and `write`, the collapsed summary appends `+N -M` (added/removed line counts) beside the path — parsed from the unified patch for `edit`, or computed from the pre-execution file content for `write`.

### Inline expand on `ctrl+o`

Press `ctrl+o` on a row to expand it **inline in the chat** — no modal, no popup. The row grows into a container showing the full output, then press `ctrl+o` again to collapse. Multiple rows can be expanded at once.

For a grouped row, the expanded view shows **every call in the group**, not just the most recent. Each call gets its own header:

```
  ✓ src/grouping.ts +3 -1  1.2s
  ✓ src/tool-overrides.ts +8 -2  500ms
```

…followed by that call's text output and (for `edit`) the full unified diff with `+`/`-` coloring. The combined body is tail-capped at 200 lines so a huge group never floods the TUI; a `… N earlier lines not shown` footer notes any truncation.

### Calm UI defaults

On session start, the extension sets the resting state to calm:

- **Working indicator suppressed** — no blinking "working…" line.
- **Tool output collapsed by default** — one row per group; expand with `ctrl+o`.
- **Thinking hidden** behind a single minimal `thinking` label (expand with `ctrl+t`).

You can still expand anything on demand; only the resting state changes.

### Relative paths

Paths are relativized against the live `cwd` at execution time, so deep absolute paths render as short project-relative ones:

```
/home/user/code/pi-stuff/packages/pi-minimal-toolcall/src/grouping.ts
        →  src/grouping.ts
```

Bash commands with embedded cwd paths are relativized too (`cd /home/user/code/.../packages` → `cd ./packages`), with token-boundary matching so a path that merely *contains* `cwd` as a substring (e.g. `/home/user-backup`) is left alone.

## Batch tools

The extension also registers four batch tools the model can call instead of repeating the built-ins. Each batch call renders as one row; `ctrl+o` expands to per-item `✓`/`✗` status plus aggregated output.

| Tool | Input | Replaces |
| --- | --- | --- |
| `read_files` | `{ paths, offset?, limit? }` | 2+ `read` calls |
| `edit_files` | `{ edits: [{ path, oldText, newText }] }` | multiple `edit` calls |
| `grep_files` | `{ queries: [{ pattern, path?, ... }] }` | multiple `grep` calls |
| `find_files` | `{ queries: [{ pattern, path?, limit? }] }` | multiple `find` calls |

- **Partial failures surface per item** (`✗ path <error>`); the batch throws only if *every* item fails.
- **Live `cwd`** — each item runs the built-in tool definition with the current `ctx.cwd`.
- **Spinner stays stable** while a batch is in flight: per-item `onUpdate` ticks keep the spinner alive without allocating a row per item. Once the final result lands, the spinner is replaced by the collapsed summary (`Read 4 files`, `Edit 2 files`, `Grep 3 searches`, `Find 1 search`).

## Install

```bash
pi install npm:@whitespace/pi-minimal-toolcall
```

One-off session:

```bash
pi -e npm:@whitespace/pi-minimal-toolcall
```

Requires `@earendil-works/pi-coding-agent`, `pi-ai`, and `pi-tui` `^0.79.0` (declared as peer dependencies).

## Compatibility

- **Scroll preservation is opt-in.** Expanding a tool row that sits above the visible viewport triggers a full TUI re-render that clears terminal scrollback. To preserve scrollback in that case, install `@whitespace/pi-preserve-scroll` alongside this package — it ships the TUI patch.
- **Other extensions calling `setToolsExpanded`** are unaffected — this package only changes the renderer, not *when* `setToolsExpanded` fires.
- **Tools registered by other extensions** are not part of the grouping. They render with their own renderer; if a group mixes our tools and another extension's tool, the other tool's row breaks the group.

## Development

```bash
bun install
bun run check        # lint + typecheck + test
bun run pack:dry     # preview the published tarball
```

## License

MIT
