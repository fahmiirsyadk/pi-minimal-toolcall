import assert from "node:assert/strict";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, test } from "node:test";
import {
	DEFAULT_MINIMAL_TOOLCALL_CONFIG,
	loadConfig,
	normalizeConfig,
	saveConfig,
} from "./index.js";

function tempDir(): string {
	const dir = join(
		tmpdir(),
		`pi-minimal-toolcall-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(dir, { recursive: true });
	return dir;
}

after(() => {
	// Best-effort cleanup of any leftover temp dirs created by tests.
	// Tests are responsible for cleaning their own; this catches stragglers.
});

// --- normalizeConfig ------------------------------------------------------

test("normalizeConfig: undefined / null / non-object → defaults", () => {
	assert.deepEqual(normalizeConfig(undefined), DEFAULT_MINIMAL_TOOLCALL_CONFIG);
	assert.deepEqual(normalizeConfig(null), DEFAULT_MINIMAL_TOOLCALL_CONFIG);
	assert.deepEqual(normalizeConfig("string"), DEFAULT_MINIMAL_TOOLCALL_CONFIG);
	assert.deepEqual(normalizeConfig(42), DEFAULT_MINIMAL_TOOLCALL_CONFIG);
});

test("normalizeConfig: empty object → defaults", () => {
	assert.deepEqual(normalizeConfig({}), DEFAULT_MINIMAL_TOOLCALL_CONFIG);
});

test("normalizeConfig: full valid object → returned deep-equal to input", () => {
	const input = {
		version: 1,
		showWorkingIndicator: true,
		toolsExpandedByDefault: true,
		hiddenThinkingLabel: "pondering",
		registerToolOverrides: {
			read: false,
			grep: true,
			find: true,
			ls: false,
			bash: true,
			edit: true,
			write: true,
		},
		batchToolsEnabled: false,
		groupingMode: "consecutive",
		expandedBodyMaxLines: 100,
		spinnerIntervalMs: 100,
		spinnerFrames: ["a", "b", "c"],
		showArgOnSummary: "always",
		writeExpandMode: "both",
		showDiffSuffix: false,
		showErrorMark: false,
		customToolOverrides: { my_tool: { enabled: true, outputMode: "preview" } },
		debug: true,
	};
	const out = normalizeConfig(input);
	assert.deepEqual(out, input);
});

test("normalizeConfig: invalid version → default version 1 (output always 1)", () => {
	const out = normalizeConfig({ version: 999 });
	assert.equal(out.version, 1);
});

test("normalizeConfig: invalid groupingMode → default proximity", () => {
	assert.equal(
		normalizeConfig({ groupingMode: "foo" }).groupingMode,
		"proximity",
	);
	assert.equal(
		normalizeConfig({ groupingMode: undefined }).groupingMode,
		"proximity",
	);
});

test("normalizeConfig: invalid spinnerFrames (empty, non-string) → default frames", () => {
	const defaultFrames = DEFAULT_MINIMAL_TOOLCALL_CONFIG.spinnerFrames;
	assert.deepEqual(
		normalizeConfig({ spinnerFrames: [] }).spinnerFrames,
		defaultFrames,
	);
	assert.deepEqual(
		normalizeConfig({ spinnerFrames: [1, 2, 3] }).spinnerFrames,
		defaultFrames,
	);
	assert.deepEqual(
		normalizeConfig({ spinnerFrames: "not-an-array" }).spinnerFrames,
		defaultFrames,
	);
	// Partial valid (some non-strings) → only the valid strings survive
	assert.deepEqual(
		normalizeConfig({ spinnerFrames: ["x", 1, "y"] }).spinnerFrames,
		["x", "y"],
	);
});

test("normalizeConfig: out-of-range spinnerIntervalMs → clamped", () => {
	assert.equal(normalizeConfig({ spinnerIntervalMs: 5 }).spinnerIntervalMs, 20);
	assert.equal(
		normalizeConfig({ spinnerIntervalMs: 99999 }).spinnerIntervalMs,
		2000,
	);
	assert.equal(
		normalizeConfig({ spinnerIntervalMs: 50.7 }).spinnerIntervalMs,
		50,
	);
	assert.equal(
		normalizeConfig({ spinnerIntervalMs: "abc" }).spinnerIntervalMs,
		80,
	);
});

test("normalizeConfig: out-of-range expandedBodyMaxLines → clamped", () => {
	assert.equal(
		normalizeConfig({ expandedBodyMaxLines: -1 }).expandedBodyMaxLines,
		0,
	);
	assert.equal(
		normalizeConfig({ expandedBodyMaxLines: 99999 }).expandedBodyMaxLines,
		2000,
	);
});

test("normalizeConfig: customToolOverrides entry for a built-in name → entry dropped", () => {
	const out = normalizeConfig({
		customToolOverrides: {
			read: { enabled: true, outputMode: "summary" }, // built-in → dropped
			bash: true, // built-in shorthand → dropped
			sidechat: { enabled: true, outputMode: "preview" }, // kept
		},
	});
	assert.deepEqual(out.customToolOverrides, {
		sidechat: { enabled: true, outputMode: "preview" },
	});
});

test("normalizeConfig: customToolOverrides boolean shorthand", () => {
	assert.deepEqual(
		normalizeConfig({ customToolOverrides: { x: true } }).customToolOverrides,
		{ x: { enabled: true, outputMode: "summary" } },
	);
	assert.deepEqual(
		normalizeConfig({ customToolOverrides: { x: false } }).customToolOverrides,
		{ x: { enabled: false, outputMode: "summary" } },
	);
});

test("normalizeConfig: customToolOverrides invalid outputMode → default 'summary'", () => {
	assert.deepEqual(
		normalizeConfig({
			customToolOverrides: { x: { enabled: true, outputMode: "bogus" } },
		}).customToolOverrides,
		{ x: { enabled: true, outputMode: "summary" } },
	);
});

test("normalizeConfig: _comment* keys are dropped", () => {
	const out = normalizeConfig({
		_comment_top: "ignored",
		_comment_other: "also ignored",
		showWorkingIndicator: true,
	});
	assert.equal(out.showWorkingIndicator, true);
	assert.equal(
		(out as unknown as Record<string, unknown>)["_comment_top"],
		undefined,
	);
	assert.equal(
		(out as unknown as Record<string, unknown>)["_comment_other"],
		undefined,
	);
});

// --- loadConfig -----------------------------------------------------------

test("loadConfig: missing file → defaults, no error", () => {
	const path = join(tempDir(), "does-not-exist.json");
	const result = loadConfig(path);
	assert.deepEqual(result.config, DEFAULT_MINIMAL_TOOLCALL_CONFIG);
	assert.equal(result.error, undefined);
});

test("loadConfig: malformed JSON → defaults + error message", () => {
	const dir = tempDir();
	const path = join(dir, "config.json");
	writeFileSync(path, "{ not valid json", "utf-8");
	const result = loadConfig(path);
	assert.deepEqual(result.config, DEFAULT_MINIMAL_TOOLCALL_CONFIG);
	assert.match(result.error ?? "", /Failed to parse/);
	rmSync(dir, { recursive: true, force: true });
});

test("loadConfig: valid file → normalized config", () => {
	const dir = tempDir();
	const path = join(dir, "config.json");
	writeFileSync(
		path,
		JSON.stringify({ showWorkingIndicator: true, groupingMode: "none" }),
		"utf-8",
	);
	const result = loadConfig(path);
	assert.equal(result.config.showWorkingIndicator, true);
	assert.equal(result.config.groupingMode, "none");
	assert.equal(result.error, undefined);
	rmSync(dir, { recursive: true, force: true });
});

test("loadConfig: fingerprint cache — repeated calls return a fresh clone (mutation does not leak)", () => {
	const dir = tempDir();
	const path = join(dir, "config.json");
	writeFileSync(path, JSON.stringify({ hiddenThinkingLabel: "x" }), "utf-8");
	const r1 = loadConfig(path);
	const r2 = loadConfig(path);
	// Each call returns a fresh object (clone of the cached value), so
	// mutating one doesn't affect the other.
	r1.config.hiddenThinkingLabel = "mutated-r1";
	assert.equal(r2.config.hiddenThinkingLabel, "x");
	// The cache itself is untouched by external mutation: a subsequent
	// load returns a clone with the on-disk value, not the mutated one.
	const r3 = loadConfig(path);
	assert.equal(r3.config.hiddenThinkingLabel, "x");
	assert.notEqual(r1.config, r2.config);
	assert.notEqual(r2.config, r3.config);
	rmSync(dir, { recursive: true, force: true });
});

test("loadConfig: write invalidates the cache (next load sees the new file)", () => {
	const dir = tempDir();
	const path = join(dir, "config.json");
	writeFileSync(path, JSON.stringify({ hiddenThinkingLabel: "v1" }), "utf-8");
	const r1 = loadConfig(path);
	assert.equal(r1.config.hiddenThinkingLabel, "v1");
	// saveConfig writes a new file, invalidates the cache.
	const saved = saveConfig(
		{ ...DEFAULT_MINIMAL_TOOLCALL_CONFIG, hiddenThinkingLabel: "v2" },
		path,
	);
	assert.equal(saved.success, true);
	// Wait briefly for mtime to differ (some filesystems have 1s resolution).
	const before2 = Date.now();
	while (Date.now() - before2 < 50) {
		// tight loop
	}
	const r2 = loadConfig(path);
	assert.equal(r2.config.hiddenThinkingLabel, "v2");
	rmSync(dir, { recursive: true, force: true });
});

// --- saveConfig -----------------------------------------------------------

test("saveConfig: writes normalized JSON, parent dir is created", () => {
	const dir = tempDir();
	const path = join(dir, "nested", "config.json");
	const saved = saveConfig(
		{ ...DEFAULT_MINIMAL_TOOLCALL_CONFIG, hiddenThinkingLabel: "nested" },
		path,
	);
	assert.equal(saved.success, true);
	assert.ok(existsSync(path));
	const onDisk = JSON.parse(readFileSync(path, "utf-8"));
	assert.equal(onDisk.hiddenThinkingLabel, "nested");
	rmSync(dir, { recursive: true, force: true });
});

test("saveConfig: round-trip — save then load returns deep-equal defaults", () => {
	const dir = tempDir();
	const path = join(dir, "config.json");
	const saved = saveConfig(DEFAULT_MINIMAL_TOOLCALL_CONFIG, path);
	assert.equal(saved.success, true);
	const loaded = loadConfig(path);
	assert.deepEqual(loaded.config, DEFAULT_MINIMAL_TOOLCALL_CONFIG);
	rmSync(dir, { recursive: true, force: true });
});

test("saveConfig: invalid input is normalized on the way out", () => {
	const dir = tempDir();
	const path = join(dir, "config.json");
	const saved = saveConfig(
		// biome-ignore lint/suspicious/noExplicitAny: intentional bad input for the test
		{
			groupingMode: "bogus",
			spinnerIntervalMs: 99999,
			registerToolOverrides: { read: "yes" },
		} as any,
		path,
	);
	assert.equal(saved.success, true);
	const onDisk = JSON.parse(readFileSync(path, "utf-8"));
	assert.equal(onDisk.groupingMode, "proximity");
	assert.equal(onDisk.spinnerIntervalMs, 2000);
	assert.equal(onDisk.registerToolOverrides.read, true); // boolean coercion of "yes" → fallback default
	rmSync(dir, { recursive: true, force: true });
});

test("saveConfig: example file round-trips to defaults", async () => {
	const { readFile } = await import("node:fs/promises");
	const examplePath = join(
		import.meta.dirname,
		"..",
		"..",
		"config",
		"config.example.json",
	);
	const raw = await readFile(examplePath, "utf-8");
	const parsed = JSON.parse(raw);
	const normalized = normalizeConfig(parsed);
	// Every non-underscore-prefixed field in the example must equal the default
	// (the example is the default + `_comment*` keys).
	assert.equal(normalized.version, DEFAULT_MINIMAL_TOOLCALL_CONFIG.version);
	assert.equal(
		normalized.showWorkingIndicator,
		DEFAULT_MINIMAL_TOOLCALL_CONFIG.showWorkingIndicator,
	);
	assert.equal(
		normalized.toolsExpandedByDefault,
		DEFAULT_MINIMAL_TOOLCALL_CONFIG.toolsExpandedByDefault,
	);
	assert.equal(
		normalized.hiddenThinkingLabel,
		DEFAULT_MINIMAL_TOOLCALL_CONFIG.hiddenThinkingLabel,
	);
	assert.deepEqual(
		normalized.registerToolOverrides,
		DEFAULT_MINIMAL_TOOLCALL_CONFIG.registerToolOverrides,
	);
	assert.equal(
		normalized.batchToolsEnabled,
		DEFAULT_MINIMAL_TOOLCALL_CONFIG.batchToolsEnabled,
	);
	assert.equal(
		normalized.groupingMode,
		DEFAULT_MINIMAL_TOOLCALL_CONFIG.groupingMode,
	);
	assert.equal(
		normalized.expandedBodyMaxLines,
		DEFAULT_MINIMAL_TOOLCALL_CONFIG.expandedBodyMaxLines,
	);
	assert.equal(
		normalized.spinnerIntervalMs,
		DEFAULT_MINIMAL_TOOLCALL_CONFIG.spinnerIntervalMs,
	);
	assert.deepEqual(
		normalized.spinnerFrames,
		DEFAULT_MINIMAL_TOOLCALL_CONFIG.spinnerFrames,
	);
	assert.equal(
		normalized.showArgOnSummary,
		DEFAULT_MINIMAL_TOOLCALL_CONFIG.showArgOnSummary,
	);
	assert.equal(
		normalized.writeExpandMode,
		DEFAULT_MINIMAL_TOOLCALL_CONFIG.writeExpandMode,
	);
	assert.equal(
		normalized.showDiffSuffix,
		DEFAULT_MINIMAL_TOOLCALL_CONFIG.showDiffSuffix,
	);
	assert.equal(
		normalized.showErrorMark,
		DEFAULT_MINIMAL_TOOLCALL_CONFIG.showErrorMark,
	);
	assert.deepEqual(normalized.customToolOverrides, {});
	assert.equal(normalized.debug, DEFAULT_MINIMAL_TOOLCALL_CONFIG.debug);
});

// Suppress unused-import warnings for the helpers used only in some tests.
void before;
void beforeEach;
