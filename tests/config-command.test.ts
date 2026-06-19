import assert from "node:assert/strict";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";
import { runMinimalToolcallCommand } from "../src/config/command.js";
import {
	DEFAULT_MINIMAL_TOOLCALL_CONFIG,
	detectPreset,
	getPresetConfig,
	loadConfig,
	type MinimalToolcallConfig,
	parsePreset,
} from "../src/config/index.js";

function tempConfigPath(): string {
	return join(
		tmpdir(),
		`pi-mtc-cmd-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		"config.json",
	);
}

let lastPath = "";
let notifies: Array<{ message: string; kind: "info" | "warning" | "error" }> =
	[];

beforeEach(() => {
	lastPath = tempConfigPath();
	notifies = [];
});

after(() => {
	// Best-effort cleanup of any lingering temp files.
	if (lastPath && existsSync(lastPath)) {
		try {
			rmSync(join(lastPath, ".."), { recursive: true, force: true });
		} catch {
			// ignore
		}
	}
});

function makeNotify() {
	notifies = [];
	return (message: string, kind: "info" | "warning" | "error") => {
		notifies.push({ message, kind });
	};
}

// --- parsePreset ----------------------------------------------------------

test("parsePreset: 'calm' | ' verbose ' | 'MINIMAL' → PresetName", () => {
	assert.equal(parsePreset("calm"), "calm");
	assert.equal(parsePreset(" verbose "), "verbose");
	assert.equal(parsePreset("MINIMAL"), "minimal");
	assert.equal(parsePreset("Calm"), "calm");
});

test("parsePreset: '' | 'foo' | '  ' → undefined", () => {
	assert.equal(parsePreset(""), undefined);
	assert.equal(parsePreset("   "), undefined);
	assert.equal(parsePreset("foo"), undefined);
});

// --- getPresetConfig ------------------------------------------------------

test("getPresetConfig: 'calm' → deep equal to DEFAULT_MINIMAL_TOOLCALL_CONFIG", () => {
	assert.deepEqual(getPresetConfig("calm"), DEFAULT_MINIMAL_TOOLCALL_CONFIG);
});

test("getPresetConfig: 'verbose' → showWorkingIndicator=true, toolsExpandedByDefault=true, plus the verbose rendering knobs", () => {
	const v = getPresetConfig("verbose");
	assert.equal(v.showWorkingIndicator, true);
	assert.equal(v.toolsExpandedByDefault, true);
	// Verbose rendering knobs (plan 003).
	assert.equal(v.showArgOnSummary, "always");
	assert.equal(v.writeExpandMode, "both");
	assert.equal(v.expandedBodyMaxLines, 600);
	assert.equal(v.spinnerIntervalMs, 120);
	// Fields that verbose does not change stay default.
	assert.equal(v.groupingMode, DEFAULT_MINIMAL_TOOLCALL_CONFIG.groupingMode);
	assert.equal(
		v.hiddenThinkingLabel,
		DEFAULT_MINIMAL_TOOLCALL_CONFIG.hiddenThinkingLabel,
	);
});

test("getPresetConfig: 'minimal' → hiddenThinkingLabel='' + the minimal rendering knobs", () => {
	const m = getPresetConfig("minimal");
	assert.equal(m.hiddenThinkingLabel, "");
	assert.equal(m.showWorkingIndicator, false);
	assert.equal(m.toolsExpandedByDefault, false);
	// Minimal rendering knobs (plan 003).
	assert.equal(m.showArgOnSummary, "never");
	assert.equal(m.showDiffSuffix, false);
	assert.equal(m.showErrorMark, false);
	assert.equal(m.writeExpandMode, "summary");
	assert.equal(m.expandedBodyMaxLines, 80);
	assert.equal(m.spinnerIntervalMs, 50);
});

test("getPresetConfig: mutating the returned object does not leak into the preset table", () => {
	const a = getPresetConfig("calm");
	a.hiddenThinkingLabel = "mutated";
	a.registerToolOverrides.read = false;
	const b = getPresetConfig("calm");
	assert.equal(
		b.hiddenThinkingLabel,
		DEFAULT_MINIMAL_TOOLCALL_CONFIG.hiddenThinkingLabel,
	);
	assert.equal(b.registerToolOverrides.read, true);
});

// --- detectPreset ---------------------------------------------------------

test("detectPreset: default config → 'calm'", () => {
	assert.equal(detectPreset(DEFAULT_MINIMAL_TOOLCALL_CONFIG), "calm");
});

test("detectPreset: a config that differs from all presets → 'custom'", () => {
	const custom: MinimalToolcallConfig = {
		...DEFAULT_MINIMAL_TOOLCALL_CONFIG,
		hiddenThinkingLabel: "totally different",
	};
	assert.equal(detectPreset(custom), "custom");
});

test("detectPreset: the 'verbose' preset's config → 'verbose'", () => {
	assert.equal(detectPreset(getPresetConfig("verbose")), "verbose");
});

test("detectPreset: the 'minimal' preset's config → 'minimal'", () => {
	assert.equal(detectPreset(getPresetConfig("minimal")), "minimal");
});

// --- /minimal-toolcall show ----------------------------------------------

test("/minimal-toolcall show: writes temp config, then show emits path + preset + fields", () => {
	// Seed a temp config so show reads it instead of the user's real one.
	mkdirSync(join(lastPath, ".."), { recursive: true });
	const custom: MinimalToolcallConfig = {
		...DEFAULT_MINIMAL_TOOLCALL_CONFIG,
		hiddenThinkingLabel: "from-show-test",
	};
	// Use the loader's saveConfig (round-trips correctly). Dynamic import
	// keeps this test isolated from the static import list above.
	return import("../src/config/index.js").then(({ saveConfig }) => {
		const r = saveConfig(custom, lastPath);
		assert.equal(r.success, true);
		const notify = makeNotify();
		runMinimalToolcallCommand("show", notify, lastPath);
		assert.equal(notifies.length, 1);
		assert.ok(notifies[0]);
		const n = notifies[0];
		assert.equal(n.kind, "info");
		assert.match(
			n.message,
			new RegExp(`path: ${lastPath.replace(/[/.]/g, "\\$&")}`),
		);
		assert.match(n.message, /preset: custom/);
		assert.match(n.message, /hiddenThinkingLabel: "from-show-test"/);
		assert.match(n.message, /batchToolsEnabled: true/);
	});
});

// --- /minimal-toolcall reset ---------------------------------------------

test("/minimal-toolcall reset: writes the default config; subsequent load returns it", () => {
	return import("../src/config/index.js").then(({ saveConfig }) => {
		// Seed a non-default file so reset has something to overwrite.
		const r1 = saveConfig(
			{ ...DEFAULT_MINIMAL_TOOLCALL_CONFIG, hiddenThinkingLabel: "pre-reset" },
			lastPath,
		);
		assert.equal(r1.success, true);
		const notify = makeNotify();
		runMinimalToolcallCommand("reset", notify, lastPath);
		assert.equal(notifies.length, 1);
		assert.ok(notifies[0]);
		const n = notifies[0];
		assert.equal(n.kind, "info");
		assert.match(n.message, /Reset to defaults\./);
		// File now contains the default config.
		const { config } = loadConfig(lastPath);
		assert.equal(
			config.hiddenThinkingLabel,
			DEFAULT_MINIMAL_TOOLCALL_CONFIG.hiddenThinkingLabel,
		);
	});
});

// --- /minimal-toolcall preset --------------------------------------------

test("/minimal-toolcall preset verbose: writes the verbose preset; load returns verbose-shaped config", () => {
	return import("../src/config/index.js").then(({ saveConfig }) => {
		// Seed a non-default file so preset has something to overwrite.
		const r1 = saveConfig(
			{ ...DEFAULT_MINIMAL_TOOLCALL_CONFIG, hiddenThinkingLabel: "pre-preset" },
			lastPath,
		);
		assert.equal(r1.success, true);
		const notify = makeNotify();
		runMinimalToolcallCommand("preset verbose", notify, lastPath);
		assert.equal(notifies.length, 1);
		assert.ok(notifies[0]);
		const n = notifies[0];
		assert.equal(n.kind, "info");
		assert.match(n.message, /Applied preset "verbose"\./);
		const { config } = loadConfig(lastPath);
		assert.equal(config.showWorkingIndicator, true);
		assert.equal(config.toolsExpandedByDefault, true);
	});
});

test("/minimal-toolcall preset minimal: writes the minimal preset", () => {
	const notify = makeNotify();
	runMinimalToolcallCommand("preset minimal", notify, lastPath);
	assert.equal(notifies.length, 1);
	assert.equal(notifies[0]?.kind, "info");
	assert.match(notifies[0]?.message ?? "", /Applied preset "minimal"\./);
	const { config } = loadConfig(lastPath);
	assert.equal(config.hiddenThinkingLabel, "");
});

test("/minimal-toolcall preset invalidname: error notify; no file written", () => {
	const notify = makeNotify();
	runMinimalToolcallCommand("preset invalidname", notify, lastPath);
	assert.equal(notifies.length, 1);
	assert.ok(notifies[0]);
	const n = notifies[0];
	assert.equal(n.kind, "error");
	assert.match(n.message, /Unknown preset/);
	assert.ok(!existsSync(lastPath), "no file should be written on error");
});

// --- /minimal-toolcall unknown subcommand --------------------------------

test("/minimal-toolcall: unknown subcommand → usage notify (no save)", () => {
	const notify = makeNotify();
	runMinimalToolcallCommand("garbage", notify, lastPath);
	assert.equal(notifies.length, 1);
	assert.equal(notifies[0]?.kind, "info");
	assert.match(notifies[0]?.message ?? "", /Usage: \/minimal-toolcall/);
	assert.ok(!existsSync(lastPath));
});

test("/minimal-toolcall: empty args → usage notify (no save)", () => {
	const notify = makeNotify();
	runMinimalToolcallCommand("", notify, lastPath);
	assert.equal(notifies.length, 1);
	assert.equal(notifies[0]?.kind, "info");
	assert.match(notifies[0]?.message ?? "", /Usage:/);
});

// --- /minimal-toolcall: notify undefined is tolerated ---------------------

test("/minimal-toolcall: notify=undefined is a no-op (no throw)", () => {
	assert.doesNotThrow(() => {
		runMinimalToolcallCommand("garbage", undefined, lastPath);
	});
	assert.doesNotThrow(() => {
		runMinimalToolcallCommand("reset", undefined, lastPath);
	});
});
