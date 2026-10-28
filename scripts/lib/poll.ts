// One polling loop — bounded by attempts, or ended only by its read — and one sleep, in one place.
//
// **Three modules had already written the same three-line `sleep`** — `gh/git-pr-checks.ts`,
// `eval/eval-run.ts` and `propagate/propagate-publish.ts` — and the release command's tag watch
// would have been the fourth. `CLAUDE.md` → "No clones — single-source"
// reads an existing duplication as the signal to single-source it rather than as a license to add to
// it, so the definition moved here and those three import it.
//
// **The loop is here for the same reason the sleep is.** A caller that only needs "ask again until
// this is true, then give up" would otherwise write its own `for` with its own off-by-one; the one
// existing loop that is *not* folded in is `wait_for_pr_success`, whose body carries the merge
// gate's stable-read counting and failure classification and is therefore not this shape at all.

async function sleep(duration_ms: number): Promise<void> {
	await new Promise<void>((resolve) => {
		setTimeout(resolve, duration_ms)
	})
}

interface PollOptions {
	attempts: number
	interval_ms: number
	// Injected by the tests so a poll costs no wall clock. Production callers leave it out.
	sleeper?: (duration_ms: number) => Promise<void>
}

// **The wait goes between attempts, never after the last one**, so the budget a caller computes from
// `attempts × interval_ms` is the budget it actually spends. The pre-existing merge-gate loop in
// `git-pr-checks.ts` guards its sleep the same way; extracted here so the loop keeps one branch.
async function wait_between(
	wait: (duration_ms: number) => Promise<void>,
	interval_ms: number,
	attempt: number,
	attempts: number,
): Promise<void> {
	if (attempt < attempts - 1) await wait(interval_ms)
}

type WaitOptions = Omit<PollOptions, 'attempts'>

// **The first value `read` answers, `undefined` when the attempts run out.** `undefined` is "not yet",
// so a read that reaches a verdict — success or failure — answers it and the loop ends there.
async function poll_for<T>(
	read: () => Promise<T | undefined> | T | undefined,
	options: PollOptions,
): Promise<T | undefined> {
	const wait = options.sleeper ?? sleep

	for (let attempt = 0; attempt < options.attempts; attempt += 1) {
		// eslint-disable-next-line no-await-in-loop -- polling: each read waits on the state the previous one saw
		const value = await read()
		if (value !== undefined) return value

		// eslint-disable-next-line no-await-in-loop -- polling: each read waits on the state the previous one saw
		await wait_between(wait, options.interval_ms, attempt, options.attempts)
	}

	return undefined
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

export { poll }
export type { PollOptions, WaitOptions }
