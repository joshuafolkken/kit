import { backlog_budget, type BudgetInput } from './backlog-budget'

// The idle watch as a window a person can read: when the run began waiting on
// an empty backlog, when the wait ends, and which bound ends it. Without it the moment the wait began
// would live only in `backlog:drive`'s memory as `--active`, so a reader of the event stream could
// tell the run was waiting but not until when. The budget names the
// window, `backlog:offer` records it as an `idle` event, and `run:board` reads it back — all through the
// text written and parsed here, so the three never spell it differently.

type IdleBound = 'idle' | 'whole-run'

interface IdleWindow {
	since_ms: number
	until_ms: number
	// Which bound ends the wait: the idle budget running out, or the whole-run bound arriving first.
	bound: IdleBound
	// When the watching loop last asked the backlog — the poll the next one is counted from.
	asked_ms: number
}

const TEXT_PATTERN =
	/^idle since (?<since>\S+) until (?<until>\S+) \((?<bound>idle|whole-run)\) asked (?<asked>\S+)$/u
const IDLE_BOUND: IdleBound = 'idle'
const WHOLE_RUN_BOUND: IdleBound = 'whole-run'

// The window an idle watch opened at `active_at_ms` runs for, as asked at `now_ms`, or `undefined` when
// the watch is off. The wait ends at the earlier of the idle budget and the whole-run bound — the order
// `decide` applies.
function window_of(input: BudgetInput): IdleWindow | undefined {
	if (input.idle_budget_ms === undefined) return undefined

	const idle_until = input.active_at_ms + input.idle_budget_ms
	const run_until = input.started_at_ms + backlog_budget.WHOLE_RUN_BUDGET_MS
	const bound = run_until < idle_until ? WHOLE_RUN_BOUND : IDLE_BOUND

	return {
		since_ms: input.active_at_ms,
		until_ms: Math.min(idle_until, run_until),
		bound,
		asked_ms: input.now_ms,
	}
}

function iso_of(ms: number): string {
	return new Date(ms).toISOString()
}

function text_of(window: IdleWindow): string {
	const { since_ms, until_ms, bound, asked_ms } = window

	return `idle since ${iso_of(since_ms)} until ${iso_of(until_ms)} (${bound}) asked ${iso_of(asked_ms)}`
}

function is_bound(value: string | undefined): value is IdleBound {
	return value === IDLE_BOUND || value === WHOLE_RUN_BOUND
}

// A malformed stamp reads as no window rather than as `NaN`, so a mangled line is never drawn.
function window_from(groups: Record<string, string>, bound: IdleBound): IdleWindow | undefined {
	const since_ms = Date.parse(String(groups['since']))
	const until_ms = Date.parse(String(groups['until']))
	const asked_ms = Date.parse(String(groups['asked']))

	return Number.isNaN(since_ms + until_ms + asked_ms)
		? undefined
		: { since_ms, until_ms, bound, asked_ms }
}

function parse(text: string): IdleWindow | undefined {
	const groups = TEXT_PATTERN.exec(text)?.groups

	if (groups === undefined || !is_bound(groups['bound'])) return undefined

	return window_from(groups, groups['bound'])
}

// The next time the watching loop asks the backlog again: one `IDLE_POLL_MINUTES` after the ask the
// stream recorded, never past the end of the wait — the interval `idle_watch_reason` tells the loop.
function next_check_ms(window: IdleWindow): number {
	const poll_ms = backlog_budget.IDLE_POLL_MINUTES * backlog_budget.MS_PER_MINUTE

	return Math.min(window.asked_ms + poll_ms, window.until_ms)
}

const backlog_idle = { next_check_ms, parse, text_of, window_of }

export { backlog_idle }
export type { IdleBound, IdleWindow }
