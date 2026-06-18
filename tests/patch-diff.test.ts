import assert from "node:assert/strict";
import test from "node:test";
import { parsePatchNetLines } from "../src/tool-overrides.ts";

test("parsePatchNetLines: undefined → undefined", () => {
	assert.equal(parsePatchNetLines(undefined), undefined);
});

test("parsePatchNetLines: counts simple additions and removals", () => {
	const patch =
		"--- a/file\n+++ b/file\n@@ -1,3 +1,5 @@\n-old line\n+new line\n+another\n";
	const result = parsePatchNetLines(patch);
	assert.deepEqual(result, { added: 2, removed: 1 });
});

test("parsePatchNetLines: skips file headers but not content starting with --", () => {
	// A removed line whose content starts with `--` renders as `---- foo`.
	// The old `startsWith("---")` skip would wrongly skip it. The fix
	// (`^---\s`) only skips the actual file header `--- a/file`.
	const patch = "--- a/file\n+++ b/file\n@@ -1,2 +1,2 @@\n---- foo\n+bar\n";
	const result = parsePatchNetLines(patch);
	assert.deepEqual(result, { added: 1, removed: 1 });
});

test("parsePatchNetLines: skips +++ file header but counts ++ content", () => {
	// An added line whose content starts with `++` renders as `+++ bar`.
	// The old `startsWith("+++")` skip would wrongly skip it.
	const patch = "--- a/file\n+++ b/file\n@@ -1,2 +1,2 @@\n-old\n+++ bar\n";
	const result = parsePatchNetLines(patch);
	assert.deepEqual(result, { added: 1, removed: 1 });
});

test("parsePatchNetLines: empty patch → undefined (falsy guard)", () => {
	assert.equal(parsePatchNetLines(""), undefined);
});

test("parsePatchNetLines: only context lines → 0/0", () => {
	const patch = "--- a/file\n+++ b/file\n@@ -1,2 +1,2 @@\n context\n context\n";
	const result = parsePatchNetLines(patch);
	assert.deepEqual(result, { added: 0, removed: 0 });
});

test("parsePatchNetLines: additions only", () => {
	const patch = "+++ b/file\n@@ -1,1 +1,3 @@\n+one\n+two\n";
	const result = parsePatchNetLines(patch);
	assert.deepEqual(result, { added: 2, removed: 0 });
});
