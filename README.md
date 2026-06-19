# @whitespace/pi-minimal-toolcall

Calm tool-call rendering for [Pi](https://github.com/earendil-works/pi-coding-agent). One row per group of consecutive tool calls, regardless of tool name. Multi-tool groups join with `&`. Relative paths, syntax-highlighted write expand, `ctrl+o` to expand inline.

```
  Read 3 files & Edit 1 file (src/grouping.ts)              ctrl+o to expand
  Shell 1 command (cd ./packages && bun test)              ctrl+o to expand
  thinking
```

## Install

```bash
pi install npm:@whitespace/pi-minimal-toolcall
```

That's it. Defaults are calm. Edit the config file to change anything.

## Quick start

Edit `~/.pi/agent/extensions/pi-minimal-toolcall/config.json` (or `$PI_CODING_AGENT_DIR/extensions/pi-minimal-toolcall/config.json`):

```json
{
  "showWorkingIndicator": true,
  "toolsExpandedByDefault": true,
  "hiddenThinkingLabel": "",
  "registerToolOverrides": { "bash": false },
  "groupingMode": "proximity",
  "showArgOnSummary": "always"
}
```

Then `/reload` to apply.

Try the bundled presets:

```text
/minimal-toolcall                       # show the effective config + path
/minimal-toolcall preset verbose        # more expanded, args on multi-tool rows
/minimal-toolcall preset minimal        # bare frames, no args, no diff
/minimal-toolcall reset                 # back to defaults
```

## What you get

| Behavior | Default | How to change |
| --- | --- | --- |
| Working indicator | hidden | `showWorkingIndicator: true` |
| Tool rows | collapsed | `toolsExpandedByDefault: true` |
| Thinking | hidden behind `thinking` label | `hiddenThinkingLabel: "..."` |
| Grouping mode | `proximity` (any tool call joins until text/thinking) | `groupingMode: "consecutive" \| "none"` |
| Latest arg on summary | single-tool groups only | `showArgOnSummary: "always" \| "never"` |
| Aggregated `+N -M` | on | `showDiffSuffix: false` |
| Per-tool `✗` | on | `showErrorMark: false` |
| Write expand | full content, syntax-highlighted | `writeExpandMode: "summary" \| "both"` |
| Expanded body cap | 200 lines | `expandedBodyMaxLines: <n>` |
| Spinner | `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏` @ 80ms | `spinnerFrames: ["a","b"]`, `spinnerIntervalMs: <n>` |
| Per-tool ownership | all 7 built-ins | `registerToolOverrides: { "read": false, ... }` |
| Batch tools (`read_files`, `edit_files`, `grep_files`, `find_files`) | on | `batchToolsEnabled: false` |
| Debug log | off | `debug: true` (writes to `<agent-dir>/.../debug/debug.log`) |

Presets: `calm` (default), `verbose` (expanded previews, larger caps, args on multi-tool rows), `minimal` (bare frames, no diff, no error mark).

## How grouping works

A **group** is a run of tool calls with no text or thinking between them, regardless of tool name. Frozen when a text or thinking block appears (`message_update` with `text_start` / `thinking_start`), or when a new agent loop starts (`agent_start` — separates prompts).

```
read, read, read                  → Read 3 files
read, read, bash, read            → one row (proximity)
text or thinking
bash, bash                        → Shell 2 commands (new group)
```

`groupingMode: "consecutive"` restores the old "different tool name = new group" behavior. `"none"` makes every call its own row.

## When a tool belongs to another extension

Other extensions register their own tools with their own renderers. Their rows break proximity groups — a `read_files` from us followed by an `ide_find_symbol` from another ext renders as two rows, not a multi-tool group. Set `registerToolOverrides.<tool>: false` to let another extension own one of our built-ins.

## Batch tools

The package registers four batch tools the model can call instead of repeating built-ins:

| Tool | Input |
| --- | --- |
| `read_files` | `{ paths, offset?, limit? }` |
| `edit_files` | `{ edits: [{ path, oldText, newText }] }` |
| `grep_files` | `{ queries: [{ pattern, path? }] }` |
| `find_files` | `{ queries: [{ pattern, path? }] }` |

Each renders as one row; `ctrl+o` expands to per-item `✓`/`✗` status plus aggregated output. Partial failures surface per item.

## Reload

`/reload` re-reads `config.json` and re-registers. Tool ownership, the per-tool grouping session, and the debug-log path all take effect on the next `session_start`.

## Compatibility

- Pi `^0.79.0` (peer deps on `@earendil-works/pi-coding-agent`, `pi-ai`, `pi-tui`).
- `pi-minimal-toolcall` only changes tool rendering. `setToolsExpanded`, `setWorkingVisible`, and `setHiddenThinkingLabel` are still driven by Pi (this package sets the resting state, not the toggle).
- Tools registered by other extensions render with their own renderer and break proximity groups.

## Development

```bash
bun install
bun run check        # lint + typecheck + test
bun run pack:dry     # preview the published tarball
```

## License

MIT
