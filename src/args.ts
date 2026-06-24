/**
 * Type-safe accessor for tool-call argument objects. The SDK's
 * `ToolDefinition.execute` / `renderCall` / `renderResult` all receive
 * `args: any` (typed as `unknown` at the boundary), and every consumer
 * in this package casts it to `Record<string, unknown>` and reads keys
 * with a fallback. This helper centralizes the pattern.
 *
 * Two flavors:
 *
 * - `getArg(args, key)` — returns the value at `key` (or `undefined`).
 *   Use when the absence of the key is meaningful.
 * - `getArg(args, key, fallback)` — returns the value at `key` (or
 *   `fallback`). Use when the value is always expected and the
 *   fallback is the "missing" representation.
 *
 * `getStr(args, key, fallback)` is a string-typed variant that
 * returns the value coerced to a string when it is one, or the
 * fallback otherwise. Used everywhere a path or pattern is read.
 */
export function getArg(
	args: unknown,
	key: string,
	fallback?: unknown,
): unknown {
	if (!args || typeof args !== "object") return fallback;
	const value = (args as Record<string, unknown>)[key];
	return value === undefined ? fallback : value;
}

export function getStr(args: unknown, key: string, fallback = ""): string {
	const value = getArg(args, key, fallback);
	return typeof value === "string" ? value : fallback;
}
