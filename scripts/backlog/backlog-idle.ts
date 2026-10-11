import type { BudgetInput } from './backlog-budget'

// The idle watch as a window a person can read: when the run ran out of work and when the wait ends.
// Without it the moment the wait began would live only in `backlog:drive`'s memory as `--active`, so a
// reader of the event stream could tell the run was waiting but not until when. The budget names the
// window, `backlog:offer` records it as an `idle` event, and `run:board` reads it back — all through the
// text written and parsed here, so the three never spell it differently.

interface IdleWindow {
	since_ms: number
	until_ms: number
	// When the watching loop last asked the backlog.
	asked_ms: number
}

const TEXT_PATTERN = /^idle since (?<since>\S+) until (?<until>\S+) asked (?<asked>\S+)$/u

// The window an idle watch opened at `active_at_ms` runs for, as asked at `now_ms`, or `undefined` when
// the watch is off. The idle budget is the only bound the wait has, so it ends the window alone.
function window_of(input: BudgetInput): IdleWindow | undefined {
	if (input.idle_budget_ms === undefined) return undefined

	return {
		since_ms: input.active_at_ms,
		until_ms: input.active_at_ms + input.idle_budget_ms,
		asked_ms: input.now_ms,
	}
}

function iso_of(ms: number): string {
	return new Date(ms).toISOString()
}

function text_of(window: IdleWindow): string {
	const { since_ms, until_ms, asked_ms } = window

	return `idle since ${iso_of(since_ms)} until ${iso_of(until_ms)} asked ${iso_of(asked_ms)}`
}

// A malformed stamp reads as no window rather than as `NaN`, so a mangled line is never drawn.
function parse(text: string): IdleWindow | undefined {
	const groups = TEXT_PATTERN.exec(text)?.groups

	if (groups === undefined) return undefined

	const since_ms = Date.parse(String(groups['since']))
	const until_ms = Date.parse(String(groups['until']))
	const asked_ms = Date.parse(String(groups['asked']))

	return Number.isNaN(since_ms + until_ms + asked_ms) ? undefined : { since_ms, until_ms, asked_ms }
}

const backlog_idle = { parse, text_of, window_of }

export { backlog_idle }
export type { IdleWindow }
