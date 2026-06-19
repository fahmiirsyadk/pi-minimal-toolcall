import type { MinimalToolcallConfig } from "./config/index.js";

interface SpinnerOptions {
	frames: readonly string[];
	intervalMs: number;
}

const sessionOptions = new Map<string, SpinnerOptions>();
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
const DEFAULT_INTERVAL_MS = 80;

export function setSessionSpinnerOptions(
	sessionId: string,
	config: MinimalToolcallConfig,
): void {
	sessionOptions.set(sessionId, {
		frames:
			config.spinnerFrames.length > 0 ? config.spinnerFrames : DEFAULT_FRAMES,
		intervalMs: config.spinnerIntervalMs,
	});
}

export function getSessionSpinnerOptions(
	sessionId: string | undefined,
): SpinnerOptions {
	if (sessionId === undefined) {
		return { frames: DEFAULT_FRAMES, intervalMs: DEFAULT_INTERVAL_MS };
	}
	return (
		sessionOptions.get(sessionId) ?? {
			frames: DEFAULT_FRAMES,
			intervalMs: DEFAULT_INTERVAL_MS,
		}
	);
}

export function clearSessionSpinnerOptions(sessionId: string): void {
	sessionOptions.delete(sessionId);
	// Drop any toolCall → session mappings for this session so the
	// map doesn't leak entries for sessions that ended mid-call.
	for (const [callId, sId] of toolCallToSession) {
		if (sId === sessionId) toolCallToSession.delete(callId);
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
