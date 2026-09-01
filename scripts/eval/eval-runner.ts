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

// Only an inconclusive verdict is retried. A scenario that failed measured something, and running it
// again until it passes would turn the suite into a slot machine.
async function run_scenario(scenario: Scenario, deps: RunnerDependencies): Promise<Verdict> {
	let verdict = await deps.run_once(scenario)

	for (let attempt = 0; attempt < INCONCLUSIVE_RETRIES && verdict.is_inconclusive; attempt += 1) {
		deps.log(
			`  … ${scenario.name} produced no measurement; waiting ${String(RETRY_PAUSE_MS / MS_PER_SECOND)}s, then retrying`,
		)
		await deps.pause(RETRY_PAUSE_MS)
		verdict = await deps.run_once(scenario)
	}

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
	return await bounded_pool.bounded_map(chosen, deps.concurrency, async (scenario, index) => {
		deps.log(`  ▸ ${scenario.name} (${String(index + 1)}/${String(chosen.length)})`)

		const verdict = await run_scenario(scenario, deps)

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
}

export { eval_runner }
export type { ConcurrencyChoice, RunnerDependencies }
