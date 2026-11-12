import { change_base } from '#scripts/git/change-base'
import {
	lane_ledger,
	type LedgerEntry,
	type StopEntry,
	type StopRecord,
} from '#scripts/lane/lane-ledger'
import { lane_ledger_write } from '#scripts/lane/lane-ledger-write'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { run_ship, type ShipSection } from './run-ship'
import { run_ship_pre_detach, type PreDetachResult } from './run-ship-pre-detach'
import { run_ship_pre_detach_pinned } from './run-ship-pre-detach-pinned'
import { run_ship_pre_detach_timed } from './run-ship-pre-detach-timed'
import { run_ship_stage } from './run-ship-stage'
import type { ShipArguments } from './run-ship-steps'
import { run_ship_stop_cause } from './run-ship-stop-cause'

// A re-ship after a review failure passes over the detached ship's preflight and fast pre-detach
// checks (joshuafolkken/kit#6141): the tree they would read differs from the one they passed by the
// review's fix commits alone, and the supervised preflight and gate ask those again after the sync.
// **A followup that stopped on a check counts as one** (joshuafolkken/kit#6675): the followup stage
// already merged a moved default branch and gated it (`run-ship-sync.ts` `merge_again`), so the stop
// is a red the lane fixes on that merged tree, and a full re-detach only repeated those checks.
// **A `--review` ship keeps its `test:pinned`**: the round 1 it reuses after its own stop launches none,
// and no later stage runs it, so the fix's hunks would reach the merge with no test pinning them.
//
// It is due only while the review failure is the last thing the ledger holds of the issue's ships —
// a later ship stage means a ship ran since, whatever it ended on — and on the base the stop recorded,
// so a merge of the default branch since runs everything again.

const { PHASE, STAGE } = run_ship_stage
const { CAUSE } = run_ship_stop_cause
const SUCCESS_EXIT_CODE = 0
const REVIEW_REASONS: ReadonlySet<string> = new Set([STAGE.REVIEW, STAGE.ROUND_TWO])
const FIX_CAUSES: ReadonlySet<string> = new Set([CAUSE.CHECK, CAUSE.FINDING])
const FOLLOWUP_CHECK = { reason: STAGE.FOLLOWUP, cause: CAUSE.CHECK }
const SHIP_STAGES: ReadonlySet<string> = new Set([
	...Object.values(STAGE),
	lane_ledger_write.PRE_DETACH_STAGE,
])
const SKIP_REASON = 're-ship after review or followup failure'
const SKIP_NOTE = `${lane_ledger_write.PRE_DETACH_STAGE}: skipped (${SKIP_REASON})`

function is_followup_check(stop: Pick<StopRecord, 'reason' | 'cause'>): boolean {
	return stop.reason === FOLLOWUP_CHECK.reason && stop.cause === FOLLOWUP_CHECK.cause
}

function is_fix_failure(stop: Pick<StopRecord, 'reason' | 'cause'>): boolean {
	if (is_followup_check(stop)) return true

	return REVIEW_REASONS.has(stop.reason) && FIX_CAUSES.has(stop.cause ?? '')
}

// The stop as the ledger takes it, a fix failure's with the base it stopped on.
async function with_base(stop: StopRecord): Promise<StopRecord> {
	if (!is_fix_failure(stop)) return stop
	const base = await change_base.resolved_through_merge()

	return base === undefined ? stop : { ...stop, base }
}

function is_ship_mark(entry: LedgerEntry, issue: number): boolean {
	if (entry.kind === lane_ledger.KIND.STOP) return entry.issue === issue

	return (
		entry.kind === lane_ledger.KIND.STAGE && entry.issue === issue && SHIP_STAGES.has(entry.stage)
	)
}

// The issue's last ship stop, unless a ship stage came after it.
async function last_stop(issue: string, path?: string): Promise<StopEntry | undefined> {
	const ledger = path ?? (await lane_ledger_write.target())

	if (ledger === undefined) return undefined
	const marks = lane_ledger
		.read_entries(ledger)
		.filter((entry) => is_ship_mark(entry, Number(issue)))
	const last = marks.at(-1)

	return last?.kind === lane_ledger.KIND.STOP ? last : undefined
}

// Whether this ship of `issue` follows a fix failure on the base it stands on now.
async function is_due(issue: string, path?: string): Promise<boolean> {
	const last = await last_stop(issue, path)

	if (last?.base === undefined || !is_fix_failure(last)) return false

	return last.base === (await change_base.resolved_through_merge())
}

// The skip, said on stderr and the event stream, and the preflight section the report shows for it.
async function skipped(issue: string): Promise<ShipSection> {
	const text = run_ship_stage.event_text(issue, lane_ledger_write.PRE_DETACH_STAGE, PHASE.SKIPPED)

	console.error(SKIP_NOTE)
	await run_event_stream_emit.emit(
		run_event_stream.EVENT_KIND.SHIP_STAGE,
		run_ship_stage.with_reason(text, SKIP_REASON),
	)

	return { header: run_ship.PREFLIGHT_HEADER, body: SKIP_NOTE, code: SUCCESS_EXIT_CODE }
}

async function pinned_only(args: ShipArguments): Promise<PreDetachResult> {
	const passed = { code: SUCCESS_EXIT_CODE, out: run_ship_pre_detach.PASSED }

	return run_ship_pre_detach.with_pinned(
		passed,
		await run_ship_pre_detach_pinned.pinned_check(args),
	)
}

// The pre-detach checks a re-ship still runs: a `--review` ship's `test:pinned`, timed as the full
// checks are, and nothing for any other ship.
async function checks(args: ShipArguments): Promise<PreDetachResult> {
	if (!args.is_review) return { code: SUCCESS_EXIT_CODE, out: SKIP_NOTE }

	return await run_ship_pre_detach_timed.checks(args.number, async () => await pinned_only(args))
}

const run_ship_reship = { SKIP_NOTE, SKIP_REASON, checks, is_due, skipped, with_base }

export { run_ship_reship }
