# Changelog

## 0.2.0

Dependency diet + drop the direct command surface. Behavior is
unchanged for users with no config file. The `/minimal-toolcall`
command and its runtime implementation are removed; the three
presets now ship as static JSON files under `config/presets/` for
users to copy. The config schema and all underlying knobs are
intact — only the runtime was trimmed.

### Changed

- **Dev toolchain: bun + biome → npm + tsc + tsx.** `npm install`
  replaces `bun install`; `npm run check` runs `tsc --noEmit` plus
  `tsx --test`. No formatter, no linter. The published tarball is
  unchanged in shape (still `.ts` source files), and pi's built-in
  TypeScript loader runs them at install time.
- **`tsconfig.json` is self-contained.** The package no longer
  extends the parent monorepo's `tsconfig.base.json` (which is not
  shipped to npm). All required compiler options are inlined; the
  strict flags that matter (`verbatimModuleSyntax`,
  `noUncheckedIndexedAccess`, `noPropertyAccessFromIndexSignature`,
  `exactOptionalPropertyTypes`, `noImplicitOverride`,
  `noFallthroughCasesInSwitch`) are preserved.

### Removed

- **`/minimal-toolcall` command** (`pi.registerCommand`) and the
  `runMinimalToolcallCommand` runtime in `src/config/command.ts`.
  Users who want to see their effective config can `cat
  ~/.pi/agent/extensions/pi-minimal-toolcall/config.json`; the
  config file itself is the source of truth.
- **`PRESET_NAMES` / `PresetName`** and the `presets.ts` module.
  The `calm` / `verbose` / `minimal` presets now live as static
  JSON files under `config/presets/` for users to copy. No runtime
  knows what a preset is.
- **`@biomejs/biome`** devDep and the `lint` / `format` scripts.
  The package has no formatter/linter; the source style is
  maintained by hand. (All 4 plan 001-004 test files were written
  biome-cleanly, so the file shape matches the conventional 2-space
  indent + double quotes + semicolons + trailing commas.)
- **`@typescript/native-preview`** devDep (the `tsgo` binary).
  Replaced with regular `typescript` + `tsc`. The native preview
  was only used for the typecheck step; tests already ran under
  `tsx`.
- **The `prepack` script's `bun run` invocation.** It now runs
  `npm run check`. The check still gates `npm publish`.

### Added

- **`config/presets/{calm,verbose,minimal}.json`** — three
  ready-to-copy starter configs. The README links to them. `calm`
  is identical to the pre-0.2.0 shipped defaults; `verbose` and
  `minimal` are the same shapes the runtime presets used to expose.

### Unchanged

- All 141 tests pass. The 18 dropped tests were the
  `parsePreset` / `getPresetConfig` / `detectPreset` /
  `runMinimalToolcallCommand` coverage; the underlying behaviors
  they guarded (the config loader, the presets' values) are still
  tested via the loader's normalize-on-load path.
- The full config schema, the per-session spinner state, the
  proximity grouping, the debug log, the disposable registry, the
  per-tool ownership, the `customToolOverrides` loader hook — all
  unchanged.

## 0.1.0

First public release with full per-package config. Behavior-neutral
for users with no config file.

### Added

- **Proximity-based tool grouping.** Consecutive tool calls with
  no text or thinking between them accumulate into one row,
  regardless of tool name. Multi-tool groups join with `&`:
  `Read 3 files & Edit 1 file (src/grouping.ts)`. Different tool
  names no longer cut the group; a text/thinking block or a new
  agent loop does. `groupingMode` toggles between `proximity`
  (default), `consecutive` (pre-0.1.0 behavior), and `none`
  (every call its own row).
- **Config file** at
  `$PI_CODING_AGENT_DIR/extensions/pi-minimal-toolcall/config.json`.
  Fingerprint-cached loader, atomic write, normalize-on-save, full
  version field for forward compat. All shipped defaults match the
  pre-config hardcoded behavior, so a user with no config file sees
  no change. `config/config.example.json` ships as the starter
  template.
- **Per-tool ownership** via
  `registerToolOverrides: { read?, grep?, find?, ls?, bash?, edit?, write? }`.
  Set any to `false` to let another extension own that tool.
- **Per-rendering knobs**: `showArgOnSummary` (single-only / never
  / always), `writeExpandMode` (content / summary / both),
  `showDiffSuffix`, `showErrorMark`, `expandedBodyMaxLines`,
  `spinnerIntervalMs`, `spinnerFrames`.
- **Three presets**: `calm` (default), `verbose` (expanded previews,
  larger caps, args on multi-tool rows), `minimal` (bare frames,
  no diff, no error mark).
- **`/minimal-toolcall` command** with `show`, `reset`, and
  `preset <calm|verbose|minimal>` subcommands. Settings changes
  take effect on the next `/reload`.
- **Calm UI defaults** are now configurable:
  `showWorkingIndicator`, `toolsExpandedByDefault`,
  `hiddenThinkingLabel`.
- **Batch tools** (`read_files` / `edit_files` / `grep_files` /
  `find_files`) are now toggleable via `batchToolsEnabled`.
- **Per-session spinner state** — spinner frame sequences and
  cadence are per-session config-driven, not module-level constants.
- **Reload-safe disposal registry** for the per-session state
  (configs, groupings, spinner options). Best-effort cleanup at
  `session_shutdown` for what the public Pi API allows.
- **Opt-in debug log** at
  `$PI_CODING_AGENT_DIR/extensions/pi-minimal-toolcall/debug/debug.log`,
  gated on `debug: true`. No terminal output; failures are silent.
- **Write expand shows full content.** The expanded view of a
  `write` call renders the full written file (syntax-highlighted by
  path) instead of the bare `Successfully wrote N bytes` status
  line.
- **Bash spinner text fix.** The bash spinner now shows
  `Shell 1 command (cmd)` immediately, instead of a bare `⠋`,
  during the args-stream phase before `tool_execution_start` registers
  the call in the grouping session.
- **`getOrCreateResultContainer` is exported** for extension authors
  who want the same persistent-Container pattern in their own
  decorators.

### Removed

- `ROADMAP.md` (was an internal scratch doc, superseded by the README
  and this changelog).
- The module-level `SPINNER_FRAMES` / `SPINNER_INTERVAL_MS` constants
  (replaced by per-session config). `EXPANDED_BODY_MAX_LINES` is
  no longer the body-cap knob — it's now `config.expandedBodyMaxLines`
  directly (default 200, same numeric value as the pre-config
  `EXPANDED_BODY_MAX_LINES * 4`).

### Known limitations

- **`customToolOverrides` is not wired.** The SDK's
  `pi.getAllTools()` returns `ToolInfo` (metadata only, no
  `execute` / `label`), so wrapping a non-builtin tool's `execute`
  from the extension layer isn't possible. The decorator
  (`decorateCustomTool` in `src/config/custom-tools.ts`) is
  implemented and tested, and the `customToolOverrides` config field
  is loaded + normalized correctly — it will activate the moment
  the SDK exposes a way to fetch the full `ToolDefinition`. A
  `TODO` in `index.ts` documents this.
- **`pi.registerTool` / `pi.on` / `pi.registerCommand` are
  persistent** (the SDK has no public unregister). The disposal
  registry is best-effort: it cleans up per-session state, but the
  event handlers and command re-bind on the next `session_start` /
  reload. This matches `pi-tool-display`'s reload model.

## 0.0.1

Initial release. One-line per tool call, relative paths, no
background box, expand/hide with `ctrl+o`. Four batch tools
(`read_files` / `edit_files` / `grep_files` / `find_files`).
