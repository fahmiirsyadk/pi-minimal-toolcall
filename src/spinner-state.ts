import {
	DEFAULT_MINIMAL_TOOLCALL_CONFIG,
	type MinimalToolcallConfig,
} from "./config/index.js";

interface SpinnerOptions {
	frames: readonly string[];
	intervalMs: number;
}

const sessionConfig = new Map<string, MinimalToolcallConfig>();
// toolCallId → sessionId, so `getSpinnerFrame` can look up the
// session's spinner options for the call that's spinning.
const toolCallToSession = new Map<string, string>();

const DEFAULT_FRAMES: readonly string[] = [
	"⠋",
	"⠙",
	"⠹",
	"⠸",
	"⠼",
	"⠴",
	"⠦",
	"⠧",
	"⠇",
	"⠏",
];

export function setSessionConfig(
	sessionId: string,
	config: MinimalToolcallConfig,
): void {
	sessionConfig.set(sessionId, config);
}

export function getSessionConfig(
	sessionId: string | undefined,
): MinimalToolcallConfig {
	if (sessionId === undefined) {
		return DEFAULT_MINIMAL_TOOLCALL_CONFIG;
	}
	return sessionConfig.get(sessionId) ?? DEFAULT_MINIMAL_TOOLCALL_CONFIG;
}

export function getSessionSpinnerOptions(
	sessionId: string | undefined,
): SpinnerOptions {
	const config = getSessionConfig(sessionId);
	return {
		frames:
			config.spinnerFrames.length > 0 ? config.spinnerFrames : DEFAULT_FRAMES,
		intervalMs: config.spinnerIntervalMs,
	};
}

export function clearSessionSpinnerOptions(sessionId: string): void {
	sessionConfig.delete(sessionId);
	// Drop any toolCall → session mappings for this session so the
	// map doesn't leak entries for sessions that ended mid-call.
	const toDelete: string[] = [];
	for (const [callId, sId] of toolCallToSession) {
		if (sId === sessionId) toDelete.push(callId);
	}
	for (const callId of toDelete) {
		toolCallToSession.delete(callId);
	}
}

export function registerToolCallSession(
	toolCallId: string,
	sessionId: string,
): void {
	toolCallToSession.set(toolCallId, sessionId);
}

export function getSessionIdForToolCall(
	toolCallId: string,
): string | undefined {
	return toolCallToSession.get(toolCallId);
}

export function unregisterToolCallSession(toolCallId: string): void {
	toolCallToSession.delete(toolCallId);
}
