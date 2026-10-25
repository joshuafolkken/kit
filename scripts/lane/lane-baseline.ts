import { detached_launch } from '#scripts/run/detached-launch'
import { run_event_baseline } from '#scripts/run/event/run-event-baseline'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { lane_ledger } from './lane-ledger'
import { lane_overrun } from './lane-overrun'
import { lane_overrun_prompt } from './lane-overrun-prompt'
import { lane_stage_stats } from './lane-stage-stats'

// Every `BASELINE_MERGES`-th merge the median lane itself is investigated (joshuafolkken/kit#4887).
// The overrun investigation (`lane-overrun.ts`) reads only a lane slower than the threshold, so the time
// every lane spends is never a candidate for a cut. `run:merge` asks at each merge: the last multiple the
// ledger's merge count reached, when no note has it yet, launches a detached worker session that reads
// `lane:stats`, takes the stages and sub-stages that spend the most per merge, and files their causes
// by the overrun investigation's filing rules — the same prompt part, a cause's reducible minutes cut
// from one median merge rather than one lane (joshuafolkken/kit#4928). Its filings name no lane they
// were found during. The launch and the session's result go on the run's event stream as notes, which
// `run:board` shows.

const { EVENT_KIND } = run_event_stream
const BASELINE_MERGES = 30
const LOG_PREFIX = 'josh-lane-baseline-'
const STATS_PERIOD_DAYS = 3
const MEDIAN_PLACEHOLDER = '<median lane minutes>'
const SCOPE = 'the median merge, judged from the per-merge minutes `lane:stats` prints'

// The last multiple of `BASELINE_MERGES` the count reached: two merges recorded between two asks, or an
// ask that failed, still leave the bucket due at the next merge.
function due_bucket(merges: number): number {
	return Math.floor(merges / BASELINE_MERGES) * BASELINE_MERGES
}

// A count investigated already — a retried merge finds its note — launches no second session. A
// failure names no count, so it never answers for one.
function is_noted(events: ReadonlyArray<RunEvent>, merges: number): boolean {
	return events.some((event) => {
		const note = event.kind === EVENT_KIND.NOTE ? run_event_baseline.parse(event.text) : undefined

		return note !== undefined && note.kind !== 'failed' && note.merges === merges
	})
}

// The due bucket of the ledger's merge count, else `undefined` before the first.
async function due_merges(): Promise<number | undefined> {
	const path = await lane_ledger.target()

	if (path === undefined) return undefined

	const merges = lane_ledger.read_entries(path).filter((entry) => lane_stage_stats.is_merge(entry))
	const bucket = due_bucket(merges.length)

	return bucket > 0 ? bucket : undefined
}

function reading(merges: number): string {
	return [
		`Investigate the median lane after ${String(merges)} merges: not an overrun, but the time every lane`,
		'spends. Leave this checkout as it is: write any file, an issue body included, under the system temp',
		'directory, and never stage, commit or push.',
		`Read \`pnpm josh lane:stats --period ${String(STATS_PERIOD_DAYS)}\` — its stage table and its`,
		'implement sub-stage table — and take the stages and sub-stages that spend the most per merge, not',
		"only the largest. Read the period lanes' transcripts (the lane directories `lane:stats`",
		"reads) and the run events (`pnpm josh run:event --from 0`) for where each one's time goes, and find",
		'the causes a fix could cut.',
		'Trace each cause to what can fix it: the minutes it spends per merge, the signal that led to the',
		'spend (which command printed what), the `file:line` of the code or document that decided it, and',
		'where to fix it.',
	].join(' ')
}

// One line: `detached_launch` lets a prompt break lines, but a single line keeps the log header whole.
function prompt(issue: number, merges: number): string {
	const handling = lane_overrun_prompt.cause_handling({
		origin: undefined,
		loss_lines: lane_overrun_prompt.loss_lines_of(issue, MEDIAN_PLACEHOLDER),
		template: run_event_baseline.ended_text(merges, '<result>'),
		scope: SCOPE,
	})

	return `${reading(merges)} ${handling}`
}

function note_failure(note: string): void {
	void run_event_stream_emit.emit(EVENT_KIND.NOTE, run_event_baseline.failed_text(note))
}

// The launch at merge `issue`, the `merges`-th; its filings count against that lane.
function launched(issue: number, merges: number): string {
	return lane_overrun.launch({
		env: {},
		prompt: prompt(issue, merges),
		log_prefix: `${LOG_PREFIX}${String(merges)}-`,
		on_failure: note_failure,
	})
}

async function investigate_baseline(issue: number): Promise<void> {
	const merges = await due_merges()

	if (merges === undefined || is_noted(await run_event_stream_emit.all_events(), merges)) return

	await run_event_stream_emit.emit(
		EVENT_KIND.NOTE,
		run_event_baseline.started_text(merges, launched(issue, merges)),
	)
}

// Never fails the merge it follows: an error is a note on the stream, not a refused merge.
async function investigate(issue: number): Promise<void> {
	try {
		await investigate_baseline(issue)
	} catch (error) {
		note_failure(detached_launch.note_of(error))
	}
}

const lane_baseline = { due_bucket, investigate }

export { lane_baseline }
