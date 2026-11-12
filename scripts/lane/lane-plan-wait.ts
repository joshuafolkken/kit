import { poll } from '#scripts/lib/poll'
import { MS_PER_MINUTE } from '#scripts/lib/timeouts'
import { lane_ledger, type LedgerEntry } from './lane-ledger'
import { lane_ledger_archive } from './lane-ledger-archive'
import { lane_plan_signals } from './lane-plan-signals'
import { lane_stage_stats } from './lane-stage-stats'
import { lane_stats } from './lane-stats'

// Whether a lane that found a holder waits for it instead of yielding (joshuafolkken/kit#5986). The
// lane waits, keeping its seat, only when it was dispatched before the holder, has commits, and the
// holder's estimated remaining time — the recent median lane less the holder's elapsed time — is no
// more than the lane's own worked time, capped at `WAIT_CAP_MINUTES`. The wait itself is bounded by
// that same amount from its first ask (`waits_until`), so a holder that overruns its estimate is
// yielded to at the deadline. Anything else yields as before (joshuafolkken/kit#4926).
//
// **The wait blocks inside `lane:plan`** (`hold`), re-reading the holders once a minute, since a
// headless lane child has no way to wait between asks; one ask blocks at most `ASK_MINUTES`, under
// the Bash timeout, and answers `wait` for the child to ask again.

const WAIT_CAP_MINUTES = 30
const WAIT_CAP_MS = WAIT_CAP_MINUTES * MS_PER_MINUTE
const MEDIAN_PERIOD_DAYS = 3
const ASK_MINUTES = 9
const ASK_MS = ASK_MINUTES * MS_PER_MINUTE

// How one blocking ask ended: the holder let go, the deadline passed, or the ask's own time ran out.
type HoldEnd = 'free' | 'expired' | 'again'

interface WaitFacts {
	own_at_ms: number
	holder_at_ms: number
	has_commits: boolean
	median_ms: number
	now_ms: number
}

// The wait's deadline in ms, or undefined when the lane yields.
function deadline_of(facts: WaitFacts): number | undefined {
	const { own_at_ms, holder_at_ms, now_ms } = facts

	if (!facts.has_commits || own_at_ms >= holder_at_ms) return undefined
	const remaining = facts.median_ms - (now_ms - holder_at_ms)
	const bound = Math.min(now_ms - own_at_ms, WAIT_CAP_MS)

	return remaining <= bound ? now_ms + bound : undefined
}

// The latest dispatch of `issue` — the start of its running lane.
function dispatched_at(entries: ReadonlyArray<LedgerEntry>, issue: number): number | undefined {
	const starts = entries
		.filter((entry) => lane_stage_stats.is_dispatch(entry) && entry.issue === issue)
		.map((entry) => Date.parse(entry.at))

	return lane_stats.peak(starts)
}

function median_ms(entries: ReadonlyArray<LedgerEntry>, now_ms: number): number | undefined {
	const period = lane_stats.in_window(entries, lane_stats.window_of(MEDIAN_PERIOD_DAYS, now_ms))
	const minutes = lane_stats.median(lane_stats.merge_minutes(entries, period))

	return minutes === undefined ? undefined : minutes * MS_PER_MINUTE
}

function facts_from(
	entries: ReadonlyArray<LedgerEntry>,
	pair: { issue: number; holder: number },
	has_commits: boolean,
	now_ms: number,
): WaitFacts | undefined {
	const own_at_ms = dispatched_at(entries, pair.issue)
	const holder_at_ms = dispatched_at(entries, pair.holder)
	const median = median_ms(entries, now_ms)

	if (own_at_ms === undefined || holder_at_ms === undefined || median === undefined) {
		return undefined
	}

	return { own_at_ms, holder_at_ms, has_commits, median_ms: median, now_ms }
}

async function entries_of(): Promise<ReadonlyArray<LedgerEntry>> {
	const ledger = await lane_ledger.target()

	return ledger === undefined ? [] : lane_ledger_archive.history_at(ledger)
}

// The deadline `issue` waits on `holder` until, read off the ledger and the branch; a fact it cannot
// read yields.
async function deadline(
	issue: number,
	holder: number,
	now_ms: number,
): Promise<number | undefined> {
	const [entries, signals] = await Promise.all([entries_of(), lane_plan_signals.signals_of(issue)])
	const facts = facts_from(entries, { issue, holder }, signals.committed_files.length > 0, now_ms)

	return facts === undefined ? undefined : deadline_of(facts)
}

// Block until `is_free` answers yes, the deadline passes or this ask's time runs out, re-reading once
// a minute; `sleeper` lets a test cost no wall clock. The ask ends before a sleep that would carry it
// past `ASK_MS`, read on the clock after each read, so a slow listing cannot stretch it to the Bash
// timeout.
async function hold(
	until_ms: number,
	is_free: () => Promise<boolean>,
	sleeper: (duration_ms: number) => Promise<void> = poll.sleep,
): Promise<HoldEnd> {
	const ask_end_ms = Date.now() + ASK_MS

	return await poll.wait_for<HoldEnd>(
		async () => {
			if (Date.now() >= until_ms) return 'expired'
			if (await is_free()) return 'free'

			return Date.now() + MS_PER_MINUTE > ask_end_ms ? 'again' : undefined
		},
		{ interval_ms: MS_PER_MINUTE, sleeper },
	)
}

const lane_plan_wait = { deadline, deadline_of, facts_from, hold }

export type { HoldEnd, WaitFacts }
export { lane_plan_wait }
