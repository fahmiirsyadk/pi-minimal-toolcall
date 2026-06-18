import assert from "node:assert/strict";
import test from "node:test";
import { nounFor } from "../src/grouping.ts";
import { friendlyLabel } from "../src/tool-overrides.ts";

test("friendlyLabel: bash → Shell", () => {
	assert.equal(friendlyLabel("bash"), "Shell");
});

test("friendlyLabel: read → Read", () => {
	assert.equal(friendlyLabel("read"), "Read");
});

test("friendlyLabel: edit → Edit", () => {
	assert.equal(friendlyLabel("edit"), "Edit");
});

test("friendlyLabel: write → Write", () => {
	assert.equal(friendlyLabel("write"), "Write");
});

test("friendlyLabel: ls → Ls", () => {
	assert.equal(friendlyLabel("ls"), "Ls");
});

test("friendlyLabel: grep → Grep", () => {
	assert.equal(friendlyLabel("grep"), "Grep");
});

test("friendlyLabel: find → Find", () => {
	assert.equal(friendlyLabel("find"), "Find");
});

test("friendlyLabel: unknown tool → passthrough", () => {
	assert.equal(friendlyLabel("custom_tool"), "custom_tool");
});

test("nounFor: bash singular/plural", () => {
	assert.equal(nounFor("bash", 1), "command");
	assert.equal(nounFor("bash", 2), "commands");
});

test("nounFor: read singular/plural", () => {
	assert.equal(nounFor("read", 1), "file");
	assert.equal(nounFor("read", 3), "files");
});

test("nounFor: grep singular/plural", () => {
	assert.equal(nounFor("grep", 1), "search");
	assert.equal(nounFor("grep", 2), "searches");
});

test("nounFor: unknown tool → item/items", () => {
	assert.equal(nounFor("custom", 1), "item");
	assert.equal(nounFor("custom", 2), "items");
});
