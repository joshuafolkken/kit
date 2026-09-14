// One bounded polling loop and one sleep, in one place.
//
// **Three modules had already written the same three-line `sleep`** — `git/git-pr-checks.ts`,
// `eval/eval-run.ts` and `propagate/propagate-publish.ts` — and the release command's tag watch
// (joshuafolkken/kit#1169) would have been the fourth. `CLAUDE.md` → "No clones — single-source"
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

// **True as soon as `is_done` answers true, false when the attempts run out.** The first attempt runs
// before any wait, so a condition already met costs nothing — which is the common case for a tag that
// was created while the command was doing something else.
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

async function poll_until(is_done: () => Promise<boolean>, options: PollOptions): Promise<boolean> {
	const wait = options.sleeper ?? sleep

	for (let attempt = 0; attempt < options.attempts; attempt += 1) {
		if (await is_done()) return true

		await wait_between(wait, options.interval_ms, attempt, options.attempts)
	}

	return false
}

const poll = { poll_until, sleep }

export { poll }
export type { PollOptions }
