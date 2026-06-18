import { Type } from "@earendil-works/pi-ai";
import type {
	ExtensionAPI,
	Theme,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import {
	createEditToolDefinition,
	createFindToolDefinition,
	createGrepToolDefinition,
	createReadToolDefinition,
	keyHint,
} from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { Container, Text } from "@earendil-works/pi-tui";
import { BODY_PREFIX, LEFT_PADDING } from "./grouping.js";
import {
	clearCallText,
	clearSpinner,
	EXPANDED_BODY_MAX_LINES,
	extractOutput,
	getOrCreateCallText,
	getSpinnerFrame,
	relPath,
} from "./tool-overrides.js";

type AnyToolDef = ToolDefinition<any, any, any>;

interface ItemResult {
	key: string;
	ok: boolean;
	error?: string;
}

interface BatchDetails {
	kind: "read" | "edit" | "grep" | "find";
	results: ItemResult[];
}

const readFilesSchema = Type.Object({
	paths: Type.Array(
		Type.String({ description: "Absolute or cwd-relative file paths." }),
	),
	offset: Type.Optional(
		Type.Number({
			description: "Start line (1-indexed). Applies to every file.",
		}),
	),
	limit: Type.Optional(Type.Number({ description: "Max lines per file." })),
}) as any;

const editFilesSchema = Type.Object({
	edits: Type.Array(
		Type.Object({
			path: Type.String({ description: "Absolute or cwd-relative file path." }),
			oldText: Type.String({ description: "Exact text to replace." }),
			newText: Type.String({ description: "Replacement text." }),
		}),
	),
}) as any;

const grepFilesSchema = Type.Object({
	queries: Type.Array(
		Type.Object({
			pattern: Type.String({ description: "Regex pattern." }),
			path: Type.Optional(Type.String({ description: "Directory to search." })),
			glob: Type.Optional(Type.String({ description: "File glob filter." })),
			ignoreCase: Type.Optional(
				Type.Boolean({ description: "Case-insensitive." }),
			),
			literal: Type.Optional(
				Type.Boolean({ description: "Treat pattern as literal." }),
			),
			context: Type.Optional(Type.Number({ description: "Context lines." })),
			limit: Type.Optional(Type.Number({ description: "Max matches." })),
		}),
	),
}) as any;

const findFilesSchema = Type.Object({
	queries: Type.Array(
		Type.Object({
			pattern: Type.String({ description: "Glob pattern." }),
			path: Type.Optional(Type.String({ description: "Directory to search." })),
			limit: Type.Optional(Type.Number({ description: "Max results." })),
		}),
	),
}) as any;

const BATCH_NOUN: Record<
	BatchDetails["kind"],
	{ singular: string; plural: string }
> = {
	read: { singular: "file", plural: "files" },
	edit: { singular: "file", plural: "files" },
	grep: { singular: "search", plural: "searches" },
	find: { singular: "search", plural: "searches" },
};

const BATCH_PARTIAL_KEY = "__piMinimalToolcallBatchPartial";

/** Stable 0-line `Text` cached on `context.state` so per-item partial
 * `onUpdate` ticks do not allocate a fresh component each time. */
function getOrCreatePartialText(
	state: Record<string, unknown> | undefined,
): Text {
	let text = state?.[BATCH_PARTIAL_KEY] as Text | undefined;
	if (!text) {
		text = new Text("", 0, 0);
		if (state) state[BATCH_PARTIAL_KEY] = text;
	}
	return text;
}

/** Render the batch tool's call line on a persistent `Text` stashed in
 * `context.state`, so `renderResult` can clear it (otherwise the TUI
 * shows both the spinner row and the summary row). The line mimics the
 * end result: `<spinner> <label> <count> <noun>`. */
function renderBatchCall(
	label: string,
	nounCfg: { singular: string; plural: string },
	count: number,
	theme: Theme,
	context:
		| { toolCallId?: string; invalidate?: () => void; state?: unknown }
		| undefined,
): Text {
	const toolCallId = context?.toolCallId ?? "";
	const state = context?.state as Record<string, unknown> | undefined;
	const callText = getOrCreateCallText(state);
	const frame = toolCallId
		? getSpinnerFrame(toolCallId, context?.invalidate)
		: "⠋";
	const noun = count === 1 ? nounCfg.singular : nounCfg.plural;
	const countPart = `${count} ${noun}`;
	callText.setText(
		`${LEFT_PADDING}${theme.fg("dim", frame)} ${theme.fg("accent", label)} ${theme.fg("text", countPart)}`,
	);
	return callText;
}

function renderBatch(
	kind: string,
	details: BatchDetails,
	output: string,
	options: { expanded: boolean },
	theme: Theme,
): Component {
	const count = details.results.length;
	const nounCfg = BATCH_NOUN[details.kind] ?? {
		singular: "item",
		plural: "items",
	};
	const noun = count === 1 ? nounCfg.singular : nounCfg.plural;
	if (!options.expanded) {
		const header = `${theme.fg("dim", kind)} ${theme.fg("text", `${count} ${noun}`)}`;
		const hint =
			theme.fg("dim", " ") + keyHint("app.tools.expand", "to expand");
		return new Text(`${LEFT_PADDING}${header + hint}`, 0, 0);
	}
	// Expanded: header + per-item status + aggregated output. The TUI
	// patch (`patches/pi-tui@0.79.6.patch`) preserves the terminal
	// scrollback on this line-count change.
	const container = new Container();
	const collapseHint = keyHint("app.tools.expand", "to collapse");
	container.addChild(
		new Text(
			`${LEFT_PADDING}${theme.fg("dim", kind)} ${theme.fg("text", `${count} ${noun}`)} ${theme.fg("dim", collapseHint)}`,
			0,
			0,
		),
	);
	for (const r of details.results) {
		const mark = r.ok ? theme.fg("success", "✓") : theme.fg("error", "✗");
		const key = r.key;
		const errSuffix = r.error ? theme.fg("error", ` — ${r.error}`) : "";
		container.addChild(
			new Text(
				`${BODY_PREFIX}${mark} ${theme.fg("muted", key)}${errSuffix}`,
				0,
				0,
			),
		);
	}
	const bodyLines = output.length > 0 ? output.split("\n") : [];
	const truncated = bodyLines.length > EXPANDED_BODY_MAX_LINES;
	// Tail (last N), matching the main overrides' expanded view.
	const shown = truncated
		? bodyLines.slice(-EXPANDED_BODY_MAX_LINES)
		: bodyLines;
	for (const line of shown) {
		container.addChild(new Text(`${BODY_PREFIX}${line}`, 0, 0));
	}
	if (truncated) {
		const remaining = bodyLines.length - EXPANDED_BODY_MAX_LINES;
		container.addChild(
			new Text(
				`${BODY_PREFIX}${theme.fg(
					"dim",
					`… ${remaining} earlier line${remaining === 1 ? "" : "s"} not shown`,
				)}`,
				0,
				0,
			),
		);
	}
	return container;
}

function finalize(
	kind: BatchDetails["kind"],
	results: ItemResult[],
	sections: string[],
): { content: { type: "text"; text: string }[]; details: BatchDetails } {
	const text = sections.join("\n");
	if (results.length > 0 && results.every((r) => !r.ok)) {
		throw new Error(text || `${kind} batch failed`);
	}
	return {
		content: [{ type: "text", text }],
		details: { kind, results },
	};
}

function errText(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}

function readFilesTool(): AnyToolDef {
	return {
		name: "read_files",
		label: "read_files",
		description:
			"Read multiple files in one call. Returns each file's contents under a header. Use instead of repeated read calls for 2+ files.",
		promptSnippet: "Read multiple files in one call (2+ files).",
		parameters: readFilesSchema,
		renderShell: "self",
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			const { paths, offset, limit } = params as {
				paths: string[];
				offset?: number;
				limit?: number;
			};
			const results: ItemResult[] = [];
			const sections: string[] = [];
			for (const path of paths) {
				const readParams: {
					path: string;
					offset?: number;
					limit?: number;
				} = { path };
				if (offset !== undefined) readParams.offset = offset;
				if (limit !== undefined) readParams.limit = limit;
				try {
					const r = await createReadToolDefinition(ctx.cwd).execute(
						toolCallId,
						readParams,
						signal,
						undefined,
						ctx,
					);
					const text = extractOutput(r);
					results.push({ key: path, ok: true });
					sections.push(`=== ${relPath(ctx.cwd, path)} ===\n${text}`);
				} catch (e) {
					const error = errText(e);
					results.push({ key: path, ok: false, error });
					sections.push(`=== ${relPath(ctx.cwd, path)} === ERROR: ${error}`);
				}
				onUpdate?.({
					content: [{ type: "text", text: sections.join("\n") }],
					details: { kind: "read", results } as BatchDetails,
				});
			}
			return finalize("read", results, sections);
		},
		renderCall(args, theme, context) {
			const count = (args as { paths?: string[] })?.paths?.length ?? 0;
			return renderBatchCall("Read", BATCH_NOUN.read, count, theme, context);
		},
		renderResult(result, options, theme, context) {
			const state = context?.state as Record<string, unknown> | undefined;
			if (options.isPartial === true) {
				// Streaming update (one item just finished inside the batch):
				// keep the call row's spinner running and the call line
				// populated, return a stable 0-line Text so the TUI does not
				// allocate a new result component on every item.
				return getOrCreatePartialText(state);
			}
			if (context?.toolCallId) clearSpinner(context.toolCallId);
			clearCallText(state);
			const details = result.details as BatchDetails;
			const output = extractOutput(
				result as { content: Array<{ type: string; text?: string }> },
			);
			return renderBatch("Read", details, output, options, theme);
		},
	};
}

function editFilesTool(): AnyToolDef {
	return {
		name: "edit_files",
		label: "edit_files",
		description:
			"Apply precise text edits to multiple files in one call. Each edit replaces exact oldText with newText in its target file.",
		promptSnippet: "Edit multiple files in one call.",
		parameters: editFilesSchema,
		renderShell: "self",
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			const { edits } = params as {
				edits: { path: string; oldText: string; newText: string }[];
			};
			const results: ItemResult[] = [];
			const sections: string[] = [];
			for (const op of edits) {
				try {
					const r = await createEditToolDefinition(ctx.cwd).execute(
						toolCallId,
						{
							path: op.path,
							edits: [{ oldText: op.oldText, newText: op.newText }],
						},
						signal,
						undefined,
						ctx,
					);
					const text = extractOutput(r);
					results.push({ key: op.path, ok: true });
					sections.push(`=== ${relPath(ctx.cwd, op.path)} ===\n${text}`);
				} catch (e) {
					const error = errText(e);
					results.push({ key: op.path, ok: false, error });
					sections.push(`=== ${relPath(ctx.cwd, op.path)} === ERROR: ${error}`);
				}
				onUpdate?.({
					content: [{ type: "text", text: sections.join("\n") }],
					details: { kind: "edit", results } as BatchDetails,
				});
			}
			return finalize("edit", results, sections);
		},
		renderCall(args, theme, context) {
			const count = (args as { edits?: unknown[] })?.edits?.length ?? 0;
			return renderBatchCall("Edit", BATCH_NOUN.edit, count, theme, context);
		},
		renderResult(result, options, theme, context) {
			const state = context?.state as Record<string, unknown> | undefined;
			if (options.isPartial === true) {
				return getOrCreatePartialText(state);
			}
			if (context?.toolCallId) clearSpinner(context.toolCallId);
			clearCallText(state);
			const details = result.details as BatchDetails;
			const output = extractOutput(
				result as { content: Array<{ type: string; text?: string }> },
			);
			return renderBatch("Edit", details, output, options, theme);
		},
	};
}

function grepFilesTool(): AnyToolDef {
	return {
		name: "grep_files",
		label: "grep_files",
		description:
			"Run multiple grep searches in one call. Each query is an independent search with its own pattern and path.",
		promptSnippet: "Run multiple grep searches in one call.",
		parameters: grepFilesSchema,
		renderShell: "self",
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			const { queries } = params as {
				queries: {
					pattern: string;
					path?: string;
					glob?: string;
					ignoreCase?: boolean;
					literal?: boolean;
					context?: number;
					limit?: number;
				}[];
			};
			const results: ItemResult[] = [];
			const sections: string[] = [];
			for (const q of queries) {
				const key = q.path ? `${q.pattern} in ${q.path}` : q.pattern;
				const grepParams = {
					pattern: q.pattern,
					...(q.path !== undefined ? { path: q.path } : {}),
					...(q.glob !== undefined ? { glob: q.glob } : {}),
					...(q.ignoreCase !== undefined ? { ignoreCase: q.ignoreCase } : {}),
					...(q.literal !== undefined ? { literal: q.literal } : {}),
					...(q.context !== undefined ? { context: q.context } : {}),
					...(q.limit !== undefined ? { limit: q.limit } : {}),
				};
				try {
					const r = await createGrepToolDefinition(ctx.cwd).execute(
						toolCallId,
						grepParams as any,
						signal,
						undefined,
						ctx,
					);
					const text = extractOutput(r);
					results.push({ key, ok: true });
					sections.push(`=== ${key} ===\n${text}`);
				} catch (e) {
					const error = errText(e);
					results.push({ key, ok: false, error });
					sections.push(`=== ${key} === ERROR: ${error}`);
				}
				onUpdate?.({
					content: [{ type: "text", text: sections.join("\n") }],
					details: { kind: "grep", results } as BatchDetails,
				});
			}
			return finalize("grep", results, sections);
		},
		renderCall(args, theme, context) {
			const count = (args as { queries?: unknown[] })?.queries?.length ?? 0;
			return renderBatchCall("Grep", BATCH_NOUN.grep, count, theme, context);
		},
		renderResult(result, options, theme, context) {
			const state = context?.state as Record<string, unknown> | undefined;
			if (options.isPartial === true) {
				return getOrCreatePartialText(state);
			}
			if (context?.toolCallId) clearSpinner(context.toolCallId);
			clearCallText(state);
			const details = result.details as BatchDetails;
			const output = extractOutput(
				result as { content: Array<{ type: string; text?: string }> },
			);
			return renderBatch("Grep", details, output, options, theme);
		},
	};
}

function findFilesTool(): AnyToolDef {
	return {
		name: "find_files",
		label: "find_files",
		description:
			"Run multiple file finds in one call. Each query is an independent glob search with its own pattern and path.",
		promptSnippet: "Find files across multiple paths in one call.",
		parameters: findFilesSchema,
		renderShell: "self",
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			const { queries } = params as {
				queries: {
					pattern: string;
					path?: string;
					limit?: number;
				}[];
			};
			const results: ItemResult[] = [];
			const sections: string[] = [];
			for (const q of queries) {
				const key = q.path ? `${q.pattern} in ${q.path}` : q.pattern;
				const findParams = {
					pattern: q.pattern,
					...(q.path !== undefined ? { path: q.path } : {}),
					...(q.limit !== undefined ? { limit: q.limit } : {}),
				};
				try {
					const r = await createFindToolDefinition(ctx.cwd).execute(
						toolCallId,
						findParams as any,
						signal,
						undefined,
						ctx,
					);
					const text = extractOutput(r);
					results.push({ key, ok: true });
					sections.push(`=== ${key} ===\n${text}`);
				} catch (e) {
					const error = errText(e);
					results.push({ key, ok: false, error });
					sections.push(`=== ${key} === ERROR: ${error}`);
				}
				onUpdate?.({
					content: [{ type: "text", text: sections.join("\n") }],
					details: { kind: "find", results } as BatchDetails,
				});
			}
			return finalize("find", results, sections);
		},
		renderCall(args, theme, context) {
			const count = (args as { queries?: unknown[] })?.queries?.length ?? 0;
			return renderBatchCall("Find", BATCH_NOUN.find, count, theme, context);
		},
		renderResult(result, options, theme, context) {
			const state = context?.state as Record<string, unknown> | undefined;
			if (options.isPartial === true) {
				return getOrCreatePartialText(state);
			}
			if (context?.toolCallId) clearSpinner(context.toolCallId);
			clearCallText(state);
			const details = result.details as BatchDetails;
			const output = extractOutput(
				result as { content: Array<{ type: string; text?: string }> },
			);
			return renderBatch("Find", details, output, options, theme);
		},
	};
}

export function registerBatchTools(pi: ExtensionAPI): void {
	pi.registerTool(readFilesTool());
	pi.registerTool(editFilesTool());
	pi.registerTool(grepFilesTool());
	pi.registerTool(findFilesTool());
}
