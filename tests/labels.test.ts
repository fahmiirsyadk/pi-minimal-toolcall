import assert from "node:assert/strict";
import { test } from "node:test";
import { friendlyLabel, nounFor } from "../src/tool-display.ts";

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

test("friendlyLabel: read_files → Read (batch tool)", () => {
	assert.equal(friendlyLabel("read_files"), "Read");
});

test("friendlyLabel: edit_files → Edit (batch tool)", () => {
	assert.equal(friendlyLabel("edit_files"), "Edit");
});

test("friendlyLabel: grep_files → Grep (batch tool)", () => {
	assert.equal(friendlyLabel("grep_files"), "Grep");
});

test("friendlyLabel: find_files → Find (batch tool)", () => {
	assert.equal(friendlyLabel("find_files"), "Find");
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

test("nounFor: read_files singular/plural (batch tool)", () => {
	assert.equal(nounFor("read_files", 1), "file");
	assert.equal(nounFor("read_files", 3), "files");
});

test("nounFor: edit_files singular/plural (batch tool)", () => {
	assert.equal(nounFor("edit_files", 1), "file");
	assert.equal(nounFor("edit_files", 2), "files");
});

test("nounFor: grep_files singular/plural (batch tool)", () => {
	assert.equal(nounFor("grep_files", 1), "search");
	assert.equal(nounFor("grep_files", 2), "searches");
});

test("nounFor: find_files singular/plural (batch tool)", () => {
	assert.equal(nounFor("find_files", 1), "search");
	assert.equal(nounFor("find_files", 2), "searches");
});

test("nounFor: unknown tool → item/items", () => {
	assert.equal(nounFor("custom", 1), "item");
	assert.equal(nounFor("custom", 2), "items");
});
