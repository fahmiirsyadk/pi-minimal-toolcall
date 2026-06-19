import assert from "node:assert/strict";
import { test } from "node:test";
import { disposableCount, disposeAll, registerDisposable } from "./index.js";

test("registerDisposable: returns a unique id, count increments", () => {
	disposeAll();
	assert.equal(disposableCount(), 0);
	const id1 = registerDisposable("a", () => {});
	assert.equal(typeof id1, "number");
	assert.equal(disposableCount(), 1);
	const id2 = registerDisposable("b", () => {});
	assert.notEqual(id1, id2);
	assert.equal(disposableCount(), 2);
	disposeAll();
});

test("disposeAll: runs every disposer in reverse registration order (LIFO)", () => {
	disposeAll();
	const order: string[] = [];
	registerDisposable("a", () => {
		order.push("a");
	});
	registerDisposable("b", () => {
		order.push("b");
	});
	registerDisposable("c", () => {
		order.push("c");
	});
	const { disposed, errors } = disposeAll();
	assert.equal(disposed, 3);
	assert.equal(errors.length, 0);
	// LIFO: c, then b, then a.
	assert.deepEqual(order, ["c", "b", "a"]);
	assert.equal(disposableCount(), 0);
});

test("disposeAll: a throw in one disposer does not stop the others; errors are reported", () => {
	disposeAll();
	const ran: string[] = [];
	registerDisposable("a", () => {
		ran.push("a");
	});
	registerDisposable("b", () => {
		throw new Error("boom");
	});
	registerDisposable("c", () => {
		ran.push("c");
	});
	const { disposed, errors } = disposeAll();
	// c runs first (LIFO); b throws and is reported; a still runs.
	assert.deepEqual(ran, ["c", "a"]);
	assert.equal(disposed, 2);
	assert.equal(errors.length, 1);
	assert.equal(errors[0]?.label, "b");
	assert.ok(errors[0]?.error instanceof Error);
	assert.equal((errors[0]?.error as Error).message, "boom");
});

test("disposeAll: empties the registry; next registerDisposable returns a fresh id", () => {
	disposeAll();
	const id1 = registerDisposable("first", () => {});
	disposeAll();
	const id2 = registerDisposable("second", () => {});
	assert.equal(typeof id2, "number");
	assert.equal(
		id2,
		id1 + 1,
		"id is monotonically increasing across dispose cycles",
	);
	assert.equal(disposableCount(), 1);
	disposeAll();
});

test("disposeAll: empty registry is a no-op", () => {
	disposeAll();
	const { disposed, errors } = disposeAll();
	assert.equal(disposed, 0);
	assert.equal(errors.length, 0);
});
