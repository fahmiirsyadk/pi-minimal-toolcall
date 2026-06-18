import assert from "node:assert/strict";
import test from "node:test";
import { relPath, shortCommand } from "../src/tool-overrides.ts";

// ─── relPath ─────────────────────────────────────────────────────────────────

test("relPath: exact cwd → .", () => {
	assert.equal(relPath("/home/user", "/home/user"), ".");
});

test("relPath: path under cwd → relative", () => {
	assert.equal(relPath("/home/user", "/home/user/foo.ts"), "foo.ts");
});

test("relPath: nested path under cwd → relative", () => {
	assert.equal(
		relPath("/home/user", "/home/user/packages/bar.ts"),
		"packages/bar.ts",
	);
});

test("relPath: path outside cwd → unchanged", () => {
	assert.equal(relPath("/home/user", "/etc/passwd"), "/etc/passwd");
});

test("relPath: empty cwd → unchanged", () => {
	assert.equal(relPath("", "/home/user/foo"), "/home/user/foo");
});

test("relPath: empty path → unchanged", () => {
	assert.equal(relPath("/home/user", ""), "");
});

// ─── shortCommand ────────────────────────────────────────────────────────────

test("shortCommand: cd into cwd subdir → ./", () => {
	assert.equal(
		shortCommand("/home/user", "cd /home/user/packages"),
		"cd ./packages",
	);
});

test("shortCommand: exact cwd → .", () => {
	assert.equal(shortCommand("/home/user", "cd /home/user"), "cd .");
});

test("shortCommand: path sharing a prefix but not cwd → unchanged", () => {
	assert.equal(
		shortCommand("/home/user", "ls /home/user-backup"),
		"ls /home/user-backup",
	);
});

test("shortCommand: multiple cwd refs in one command", () => {
	assert.equal(
		shortCommand("/home/user", "cd /home/user && ls /home/user/src"),
		"cd . && ls ./src",
	);
});

test("shortCommand: empty cwd → unchanged", () => {
	assert.equal(shortCommand("", "cd /foo"), "cd /foo");
});

test("shortCommand: empty command → unchanged", () => {
	assert.equal(shortCommand("/home/user", ""), "");
});

test("shortCommand: cwd as substring in a word → unchanged", () => {
	// /home/user-backup contains /home/user as a substring but is not the same path
	assert.equal(
		shortCommand("/home/user", "cat /home/user-backup/file"),
		"cat /home/user-backup/file",
	);
});

test("shortCommand: cwd after equals sign → relativized", () => {
	assert.equal(shortCommand("/home/user", "FOO=/home/user/bin"), "FOO=./bin");
});
