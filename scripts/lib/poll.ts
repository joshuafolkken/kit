// One polling loop — bounded by attempts, or ended only by its read — and one sleep, in one place.
//
// **Three modules had already written the same three-line `sleep`** — `gh/git-pr-checks.ts`,
// `eval/eval-run.ts` and `propagate/propagate-publish.ts` — and the release command's tag watch
// would have been the fourth. `CLAUDE.md` → "No clones — single-source"
// reads an existing duplication as the signal to single-source it rather than as a license to add to
// it, so the definition moved here and those three import it.
//
// **The loop is here for the same reason the sleep is.** A caller that only needs "ask again until
// this is true, then give up" would otherwise write its own `for` with its own off-by-one. Callers
// carry domain state in their read, including the merge gate's stable-read counters and
// failure classification; the wait itself stays here.

async function sleep(duration_ms: number): Promise<void> {
	await new Promise<void>((resolve) => {
		setTimeout(resolve, duration_ms)
	})
}

interface BackoffSchedule {
	initial_ms: number
	factor: number
	max_ms: number
}

// A CI run takes minutes, so most fixed-cadence reads of it only confirm that nothing moved, and each
// one spends REST core (joshuafolkken/kit#6719). The wait therefore lengthens while nothing changes.
const POLL_BACKOFF: BackoffSchedule = { initial_ms: 30_000, factor: 1.5, max_ms: 120_000 }

interface PollBackoff {
	// What the last read saw. A tick whose answer differs from the one before resets the interval;
	// absent, every tick reads as unchanged.
	seen?: () => string
	schedule?: BackoffSchedule
}

interface PollOptions {
	attempts: number
	interval_ms: number
	// A caller's existing wait, or an injected sleeper so tests cost no wall clock.
	sleeper?: (duration_ms: number) => Promise<void>
	// Lengthens the waits within the same budget the fixed cadence spends: `(attempts - 1) × interval_ms`.
	backoff?: PollBackoff
}

// How long to wait after `attempt`, or `undefined` once the poll is over.
type Cadence = (attempt: number) => number | undefined

// **The wait goes between attempts, never after the last one**, so the budget a caller computes from
// `attempts × interval_ms` bounds the wait. The merge gate uses this same loop to keep its
// stable-read and read-failure counters while sharing the wait between attempts.
function fixed_cadence(options: PollOptions): Cadence {
	return function next_wait(attempt: number): number | undefined {
		return attempt < options.attempts - 1 ? options.interval_ms : undefined
	}
}

interface BackoffStep {
	interval_ms: number
	seen: string | undefined
}

function next_backoff_interval(
	schedule: BackoffSchedule,
	previous: BackoffStep,
	seen: string,
): number {
	if (seen !== previous.seen) return schedule.initial_ms

	return Math.min(previous.interval_ms * schedule.factor, schedule.max_ms)
}

// The last wait is cut to what the budget has left, so the total wait stays the fixed cadence's.
function backoff_cadence(options: PollOptions, backoff: PollBackoff): Cadence {
	const schedule = backoff.schedule ?? POLL_BACKOFF
	const budget_ms = (options.attempts - 1) * options.interval_ms
	const state = { waited_ms: 0, step: { interval_ms: 0, seen: undefined } satisfies BackoffStep }

	return function next_wait(): number | undefined {
		if (state.waited_ms >= budget_ms) return undefined
		const seen = backoff.seen?.() ?? ''
		const interval_ms = next_backoff_interval(schedule, state.step, seen)
		const wait_ms = Math.min(interval_ms, budget_ms - state.waited_ms)

		Object.assign(state, { waited_ms: state.waited_ms + wait_ms, step: { interval_ms, seen } })

		return wait_ms
	}
}

function to_cadence(options: PollOptions): Cadence {
	return options.backoff === undefined
		? fixed_cadence(options)
		: backoff_cadence(options, options.backoff)
}

type WaitOptions = Omit<PollOptions, 'attempts'>

// A read that answered ends the poll, so there is nothing to wait for after it.
function wait_after(value: unknown, next_wait: Cadence, attempt: number): number | undefined {
	return value === undefined ? next_wait(attempt) : undefined
}

// **The first value `read` answers, `undefined` when the attempts run out.** `undefined` is "not yet",
// so a read that reaches a verdict — success or failure — answers it and the loop ends there.
async function poll_for<T>(
	read: () => Promise<T | undefined> | T | undefined,
	options: PollOptions,
): Promise<T | undefined> {
	const wait = options.sleeper ?? sleep
	const next_wait = to_cadence(options)

	for (let attempt = 0; ; attempt += 1) {
		// eslint-disable-next-line no-await-in-loop -- polling: each read waits on the state the previous one saw
		const value = await read()
		const wait_ms = wait_after(value, next_wait, attempt)
		if (wait_ms === undefined) return value

		// eslint-disable-next-line no-await-in-loop -- polling: each read waits on the state the previous one saw
		await wait(wait_ms)
	}
}

// **True as soon as `is_done` answers true, false when the attempts run out.** The first attempt runs
// before any wait, so a condition already met costs nothing — which is the common case for a tag that
// was created while the command was doing something else.
async function poll_until(
	is_done: () => Promise<boolean> | boolean,
	options: PollOptions,
): Promise<boolean> {
	const is_reached = await poll_for(async () => ((await is_done()) ? true : undefined), options)

	return is_reached === true
}

// **A wait that ends only when `read` answers** — a child process exiting, a ship leaving `running`.
// Its bound, if any, is the read's own: a wall-clock deadline the read answers with its failure.
async function wait_for<T>(
	read: () => Promise<T | undefined> | T | undefined,
	options: WaitOptions,
): Promise<T> {
	const value = await poll_for(read, { ...options, attempts: Infinity })
	if (value === undefined) throw new Error('an unbounded poll ran out of attempts')

	return value
}

const poll = { poll_for, poll_until, sleep, wait_for }

export { poll, POLL_BACKOFF }
export type { BackoffSchedule, PollBackoff, PollOptions, WaitOptions }
