import type { Theme, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { initTheme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";

// Initialize the singleton theme so keyHint() works in tests without a TTY.
// `initTheme` is idempotent, so re-calling it from new test files is safe.
initTheme();

/** Re-initialize the theme from a `before()` hook when a test file does
 *  not import this helper at module load. */
export function ensureTestTheme(): void {
	initTheme();
}

/** Pass-through theme: `fg`/`bold` return text unchanged so tests can assert
 * on plain strings. `keyHint` still uses the singleton theme (producing ANSI);
 * `stripAnsi` removes it for assertions. */
export const passThroughTheme = {
	fg: (_color: string, text: string): string => text,
	bold: (text: string): string => text,
} as unknown as Theme;

/** ANSI-producing theme so rendered output can be verified structurally. */
export function createAnsiTheme(): Theme {
	return {
		fg: (color: string, text: string): string =>
			`\x1b[${color === "error" ? "31" : color === "success" ? "32" : color === "accent" ? "36" : color === "dim" ? "90" : color === "muted" ? "90" : "0"}m${text}\x1b[0m`,
		bold: (text: string): string => `\x1b[1m${text}\x1b[0m`,
	} as unknown as Theme;
}

/** Strip ANSI escape codes from a string. */
export function stripAnsi(s: string): string {
	return s.replace(/\x1b\[[0-9;]*m/g, "");
}

/** Render a component at the given width and return the joined, ANSI-stripped,
 * trimmed text. Empty/0-line components render as "". */
export function renderedText(component: Component, width = 120): string {
	return stripAnsi(
		component
			.render(width)
			.map((line) => line.trimEnd())
			.join("\n")
			.trim(),
	);
}

/** Count the rendered lines (after trimming) of a component. */
export function renderedLineCount(component: Component, width = 120): number {
	const lines = component
		.render(width)
		.map((line) => stripAnsi(line.trimEnd()));
	// Drop trailing empty lines that come from padding
	while (lines.length > 0 && lines[lines.length - 1] === "") {
		lines.pop();
	}
	return lines.length;
}

/** Minimal ToolRenderContext for testing render functions. */
export interface TestRenderContext {
	args?: unknown;
	toolCallId?: string;
	invalidate?: () => void;
	lastComponent?: unknown;
	state?: Record<string, unknown>;
	cwd?: string;
	executionStarted?: boolean;
	argsComplete?: boolean;
	isPartial?: boolean;
	expanded?: boolean;
	showImages?: boolean;
	isError?: boolean;
}

export function makeContext(
	overrides: TestRenderContext = {},
): NonNullable<
	Parameters<NonNullable<ToolDefinition<any, any, any>["renderResult"]>>[3]
> {
	return {
		args: overrides.args,
		toolCallId: overrides.toolCallId ?? "call-1",
		invalidate: overrides.invalidate ?? (() => {}),
		lastComponent: overrides.lastComponent,
		state: overrides.state ?? {},
		cwd: overrides.cwd ?? "/home/user/project",
		executionStarted: overrides.executionStarted ?? false,
		argsComplete: overrides.argsComplete ?? false,
		isPartial: overrides.isPartial ?? false,
		expanded: overrides.expanded ?? false,
		showImages: overrides.showImages ?? true,
		isError: overrides.isError ?? false,
	} as NonNullable<
		Parameters<NonNullable<ToolDefinition<any, any, any>["renderResult"]>>[3]
	>;
}

/** Advance fake timers by ms and flush microtasks. */
export function wait(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}
