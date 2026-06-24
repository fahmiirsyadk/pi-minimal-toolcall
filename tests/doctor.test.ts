import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DEFAULT_MINIMAL_TOOLCALL_CONFIG } from "../src/config/index.ts";
import {
	formatDoctorReport,
	runDoctor,
} from "../src/config/doctor.ts";

function tempConfigPath(): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-doctor-"));
	return join(dir, "config.json");
}

test("doctor: missing file → defaults, source='defaults', no diagnostics", () => {
	const report = runDoctor(tempConfigPath());
	assert.equal(report.source, "defaults");
	assert.equal(report.diagnostics.length, 0);
	assert.equal(
		report.config.toolsExpandedByDefault,
		DEFAULT_MINIMAL_TOOLCALL_CONFIG.toolsExpandedByDefault,
	);
});

test("doctor: spinnerIntervalMs < 50 → warning", () => {
	const path = tempConfigPath();
	writeFileSync(path, JSON.stringify({ spinnerIntervalMs: 30 }), "utf-8");
	const report = runDoctor(path);
	const warn = report.diagnostics.find((d) => d.level === "warning");
	assert.ok(warn, "expected a warning");
	assert.match(warn?.message ?? "", /spinnerIntervalMs/);
	rmSync(path, { force: true });
});

test("doctor: expandedBodyMaxLines = 0 → warning", () => {
	const path = tempConfigPath();
	writeFileSync(path, JSON.stringify({ expandedBodyMaxLines: 0 }), "utf-8");
	const report = runDoctor(path);
	assert.ok(
		report.diagnostics.some((d) => /expandedBodyMaxLines.*0/.test(d.message)),
	);
	rmSync(path, { force: true });
});

test("doctor: showArgOnSummary=always with proximity → info", () => {
	const path = tempConfigPath();
	writeFileSync(
		path,
		JSON.stringify({
			showArgOnSummary: "always",
			groupingMode: "proximity",
		}),
		"utf-8",
	);
	const report = runDoctor(path);
	const info = report.diagnostics.find((d) => d.level === "info");
	assert.ok(info, "expected an info diagnostic");
	assert.match(info?.message ?? "", /showArgOnSummary/);
	rmSync(path, { force: true });
});

test("doctor: all 7 built-ins disabled → warning", () => {
	const path = tempConfigPath();
	writeFileSync(
		path,
		JSON.stringify({
			registerToolOverrides: {
				read: false,
				grep: false,
				find: false,
				ls: false,
				bash: false,
				edit: false,
				write: false,
			},
		}),
		"utf-8",
	);
	const report = runDoctor(path);
	assert.ok(
		report.diagnostics.some((d) => /All 7 built-in tools are disabled/.test(d.message)),
	);
	rmSync(path, { force: true });
});

test("doctor: batchToolsEnabled=false → info", () => {
	const path = tempConfigPath();
	writeFileSync(path, JSON.stringify({ batchToolsEnabled: false }), "utf-8");
	const report = runDoctor(path);
	assert.ok(
		report.diagnostics.some((d) => /batchToolsEnabled/.test(d.message)),
	);
	rmSync(path, { force: true });
});

test("doctor: customToolOverrides entries → warning", () => {
	const path = tempConfigPath();
	writeFileSync(
		path,
		JSON.stringify({
			customToolOverrides: { sidechat: { enabled: true, outputMode: "summary" } },
		}),
		"utf-8",
	);
	const report = runDoctor(path);
	assert.ok(
		report.diagnostics.some((d) =>
			/customToolOverrides has \d+ entr/.test(d.message),
		),
	);
	rmSync(path, { force: true });
});

test("doctor: clean config → 'No issues found.'", () => {
	const path = tempConfigPath();
	// Defaults are clean; an empty config normalizes to defaults.
	writeFileSync(path, "{}", "utf-8");
	const report = runDoctor(path);
	assert.equal(report.diagnostics.length, 0);
	const formatted = formatDoctorReport(report);
	assert.match(formatted, /No issues found\./);
	rmSync(path, { force: true });
});

test("formatDoctorReport: contains the config file path and JSON dump", () => {
	const path = tempConfigPath();
	const report = runDoctor(path);
	const formatted = formatDoctorReport(report);
	assert.ok(formatted.includes(`config: ${path}`));
	assert.ok(formatted.includes('"spinnerIntervalMs"'));
	assert.ok(formatted.includes("Resolved config:"));
});
