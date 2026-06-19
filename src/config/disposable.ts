/**
 * A process-global registry of cleanup callbacks. `index.ts` registers
 * its long-lived subscriptions (event handlers, override registrations,
 * the `/minimal-toolcall` command, per-session state) here, and the
 * `session_shutdown` handler calls `disposeAll()` to tear them down so
 * a `/reload` doesn't leak.
 *
 * Disposers run in **reverse** registration order (LIFO) — the most
 * recently registered disposer runs first, mirroring the typical
 * teardown order (last-registered, first-destroyed).
 *
 * Errors thrown by individual disposers do not stop the others. They
 * are returned in the `errors` array of the `disposeAll` result so the
 * caller can log them (via the debug logger) without losing the rest
 * of the teardown.
 *
 * The registry is process-global; two `@whitespace/pi-minimal-toolcall`
 * extensions loaded side-by-side would share it. In practice the
 * package is loaded once per process.
 */
interface Entry {
	id: number;
	label: string;
	dispose: () => void;
}

const entries: Entry[] = [];
let nextId = 0;

/** Register a disposer. Returns a numeric id (mostly for debugging). */
export function registerDisposable(label: string, dispose: () => void): number {
	const id = nextId++;
	entries.push({ id, label, dispose });
	return id;
}

/** Run every registered disposer in reverse order. Returns the count
 *  successfully disposed + any per-disposer errors. The registry is
 *  empty after this call, ready for a fresh round of `registerDisposable`
 *  calls (which start at id 0 again). */
export function disposeAll(): {
	disposed: number;
	errors: Array<{ label: string; error: unknown }>;
} {
	let disposed = 0;
	const errors: Array<{ label: string; error: unknown }> = [];
	while (entries.length > 0) {
		const e = entries.pop()!;
		try {
			e.dispose();
			disposed++;
		} catch (error) {
			errors.push({ label: e.label, error });
		}
	}
	return { disposed, errors };
}

/** Number of currently-registered disposers. Useful for tests and
 *  debug logging. */
export function disposableCount(): number {
	return entries.length;
}
