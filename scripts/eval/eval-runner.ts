import { bounded_pool } from '#scripts/bounded-pool'
import type { Verdict } from './eval-judge'
import type { Scenario } from './eval-scenario'

// How the suite spends its wall-clock. Kept out of `eval-run.ts` because that file ends in a
// top-level `await main()` and runs the whole suite the moment it is imported — a test could not
// reach any of this while it lived there, which is why the run loop was the one part of the harness
// with no test at all (joshuafolkken/kit#1144).

const MS_PER_SECOND = 1000
// An inconclusive verdict means the session did not produce a measurement, and a retried scenario is
// announced rather than quietly replaced. One attempt, because a second buys nothing: raised to two
// while investigating joshuafolkken/kit#1001 and put back, since neither the extra attempt nor the
// longer waits recovered a single scenario — and the pair roughly doubled the worst-case suite time
// for the same verdict.
const INCONCLUSIVE_RETRIES = 1
// A retry waits, but only long enough not to be fired into the same instant as the failure that
// asked for it. It was 60s, chosen when an empty transcript was still believed to be pacing;
// joshuafolkken/kit#1001 measured the cause as `API Error: Unable to connect to API
// (ConnectionRefused)` and measured that longer waits recovered nothing, so the minute was buying
// nothing but a minute — and under a pool it holds a slot the whole time.
//
// **The one thing a longer wait could buy under a pool is a smaller session count**, which is what
// joshuafolkken/kit#1144 measured the ConnectionRefused symptom to track. It is not worth a minute:
// a sibling scenario is a whole Claude session, so it outlives any wait short enough to belong here,
// and the retry would come back to the same width it left. Where the width itself is the problem,
// `JOSH_EVAL_CONCURRENCY` is the lever — a wait is not.
const RETRY_PAUSE_MS = 5000

// How many sessions may come back unable to reach the API before the suite stops starting new ones.
// Every one of them is a whole Claude session that returns no measurement, and the cause is a setup
// failure — an inherited socket, a dropped connection — that the next session meets unchanged, so
// spending the rest of the suite on it buys nothing but the same answer at full price
// (joshuafolkken/kit#1197).
//
// **Two rather than one**, so a single transient refusal does not abandon a run that would have
// measured the other four. Two in a row is no longer transient.
//
// **What it stops is sessions, not the pool.** A scenario already in flight is left to finish — the
// pool has no cancellation seam and killing a live session would throw away a measurement that is
// already paid for. What is skipped is every session not yet started: the retries first, which is
// where the saving lands hardest at the default width (five scenarios, five slots, up to five retry
// sessions), and then any scenario still queued once the suite grows past that width.
const UNREACHABLE_LIMIT = 2

// **Bounded, not unbounded.** The scenarios are independent execution units — each builds its own
// sandbox — so nothing about them has to be serialized, and the comment that said otherwise ("the
// scenarios share one API rate budget") asserted a cause joshuafolkken/kit#1001 had already looked
// for and not found. What that Issue did find is a connection-level failure, whose behavior under
// concurrency was unmeasured; a cap is what keeps a suite that grows from testing that at full
// fan-out.
//
// Five is the measured number rather than a round one: the suite's five scenarios were run at this
// width twice, taking 97s and 110s against the paced-serial run's 419s on the same tree — 5/5 held
// every time (joshuafolkken/kit#1144). The second of those needed the retry below for one scenario
// and got it back, which is the shape to expect rather than a suite that collapses. Lower the width
// with `JOSH_EVAL_CONCURRENCY` on a connection that cannot hold that many sessions; the failure to
// watch for is #1001's, an inconclusive scenario whose `?` line names ConnectionRefused.
const DEFAULT_CONCURRENCY = 5
const CONCURRENCY_ENV_KEY = 'JOSH_EVAL_CONCURRENCY'
const CONCURRENCY_PATTERN = /^[1-9]\d*$/u

type ConcurrencyChoice = { kind: 'limit'; limit: number } | { kind: 'problem'; problem: string }

// A misspelled width is refused rather than silently replaced by the default. The number decides how
// the suite spends its sessions, so a run that quietly ignored `JOSH_EVAL_CONCURRENCY=2` would report
// a measurement of something the caller did not ask for — and the caller's next act is to compare it
// against another run.
function read_concurrency(raw: string | undefined): ConcurrencyChoice {
	if (raw === undefined || raw.trim() === '') return { kind: 'limit', limit: DEFAULT_CONCURRENCY }

	const trimmed = raw.trim()

	if (!CONCURRENCY_PATTERN.test(trimmed)) {
		return {
			kind: 'problem',
			problem: `${CONCURRENCY_ENV_KEY} must be a positive integer, not "${raw}"`,
		}
	}

	return { kind: 'limit', limit: Number(trimmed) }
}

// The session run, the reporting and the waiting are handed in rather than imported: a test of the
// run loop must not spawn a real Claude session, and the loop is the only part of the harness whose
// bugs cost minutes rather than milliseconds.
interface RunnerDependencies {
	run_once: (scenario: Scenario) => Promise<Verdict>
	report: (verdict: Verdict) => void
	log: (message: string) => void
	pause: (duration_ms: number) => Promise<void>
	concurrency: number
}

// How many sessions have already come back unable to reach the API. Shared across the pool by
// reference rather than counted from the verdicts, because the decision has to be made while the
// other scenarios are still running — a count taken after `bounded_map` resolves is taken after
// every session it could have saved has already been spent.
interface UnreachableTally {
	count: number
}

function fresh_tally(): UnreachableTally {
	return { count: 0 }
}

// Asked in three places — in front of a scenario's first attempt, in front of a retry, and in front of
// the progress line that announces one — so it is one predicate rather than the same comparison
// written out three times.
function can_start_session(tally: UnreachableTally): boolean {
	return tally.count < UNREACHABLE_LIMIT
}

// Only an inconclusive verdict is retried, and only the half of it that a second attempt could
// settle. A scenario that failed measured something, and running it again until it passes would turn
// the suite into a slot machine; a scenario whose session never reached the API measured nothing for
// a reason the retry meets unchanged — joshuafolkken/kit#1001 measured that neither an extra attempt
// nor a longer wait recovered a single one.
//
// **The tally gates this too, and that is where the saving actually lands.** At the shipped default —
// five scenarios, five slots — `bounded_map` dequeues every scenario before the first verdict returns,
// so the check in front of a scenario's *first* attempt can never fire and the only sessions left to
// skip are the retries. Gated here as well, a suite that has already had two sessions refused stops
// paying for up to five more into the same dead connection; gated only in front of the first attempt,
// it pays for all of them and the abort is unreachable code at the default width.
function is_retryable(verdict: Verdict, tally: UnreachableTally): boolean {
	if (!can_start_session(tally)) return false

	return verdict.is_inconclusive && !verdict.is_unreachable
}

// The verdict for a scenario whose session was never started. Inconclusive because nothing was
// measured, and unreachable because the reason is the same one that stopped the suite — reporting it
// as an ordinary non-measurement would hide the abort behind five scenarios that look merely quiet.
// The count comes from the tally rather than from `UNREACHABLE_LIMIT`: at the default width four
// in-flight sessions can all come back refused before a queued scenario is dequeued, and a note
// naming the limit would then understate what was actually observed.
function skipped_verdict(scenario: Scenario, tally: UnreachableTally): Verdict {
	return {
		name: scenario.name,
		rule: scenario.rule,
		is_pass: false,
		is_inconclusive: true,
		is_unreachable: true,
		note: `session not started: ${String(tally.count)} earlier sessions could not reach the API`,
		failures: [],
		calls: [],
	}
}

async function run_with_retry(
	scenario: Scenario,
	deps: RunnerDependencies,
	tally: UnreachableTally,
): Promise<Verdict> {
	let verdict = await deps.run_once(scenario)
	let attempt = 0

	while (attempt < INCONCLUSIVE_RETRIES && is_retryable(verdict, tally)) {
		attempt += 1
		deps.log(
			`  … ${scenario.name} produced no measurement; waiting ${String(RETRY_PAUSE_MS / MS_PER_SECOND)}s, then retrying`,
		)
		await deps.pause(RETRY_PAUSE_MS)
		verdict = await deps.run_once(scenario)
	}

	return verdict
}

async function run_scenario(
	scenario: Scenario,
	deps: RunnerDependencies,
	tally: UnreachableTally = fresh_tally(),
): Promise<Verdict> {
	if (!can_start_session(tally)) return skipped_verdict(scenario, tally)

	const verdict = await run_with_retry(scenario, deps, tally)

	if (verdict.is_unreachable) tally.count += 1

	return verdict
}

// Each verdict is reported the moment its own scenario ends, not after the pool drains. Every line
// names its scenario, so they stay readable interleaved — and a suite that printed nothing until the
// last session returned would be indistinguishable from a stalled one for its whole duration, which
// is the hazard joshuafolkken/kit#1001 added the progress lines for.
//
// **What a pool changes is which scenario the silence belongs to, not how long it can last.** Every
// `▸` line prints at once and then nothing does until the first verdict, where the serial suite
// printed one `▸` and went quiet for that scenario alone — but the quiet stretch is bounded by one
// session timeout either way, because a serial run went equally quiet for the session it was on. What
// is lost is that the last line printed no longer names the scenario that is stalling; the verdicts
// that do arrive name the ones that are not.
async function run_all(
	chosen: ReadonlyArray<Scenario>,
	deps: RunnerDependencies,
): Promise<Array<Verdict>> {
	const tally = fresh_tally()

	return await bounded_pool.bounded_map(chosen, deps.concurrency, async (scenario, index) => {
		// Announced only where a session is about to start. A `▸` line in front of a scenario the tally
		// has already skipped contradicts the `⚠ … session not started` line that follows it.
		if (can_start_session(tally)) {
			deps.log(`  ▸ ${scenario.name} (${String(index + 1)}/${String(chosen.length)})`)
		}

		const verdict = await run_scenario(scenario, deps, tally)

		deps.report(verdict)

		return verdict
	})
}

const eval_runner = {
	CONCURRENCY_ENV_KEY,
	DEFAULT_CONCURRENCY,
	INCONCLUSIVE_RETRIES,
	read_concurrency,
	RETRY_PAUSE_MS,
	run_all,
	run_scenario,
	UNREACHABLE_LIMIT,
}

export { eval_runner }
export type { ConcurrencyChoice, RunnerDependencies, UnreachableTally }
