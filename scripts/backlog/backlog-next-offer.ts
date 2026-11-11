import type { EpicChild } from '#scripts/epic/epic-graph'
import type { EpicNextResult } from '#scripts/epic/epic-report'
import type { OfferExclusion, OfferRecord } from '#scripts/lane/lane-ledger-schema-offer'
import { lane_ledger_write } from '#scripts/lane/lane-ledger-write'
import type { OptedIn, PoolContext } from './backlog-gate-scope'
import { backlog_next_report } from './backlog-next-report'
import { backlog_wait_cause } from './backlog-wait-cause'

// The decision of one `backlog:next` ask, written to the lane ledger as one `offer` line
// (joshuafolkken/kit#7306): an ask that started nothing leaves no `held` of its own, so without it
// a free lane that stayed empty could not be told apart afterwards — a stale listing, an issue held
// for triage, or one waiting on a chain. The write is `lane_ledger_write.record`'s best effort, so a
// failed append never changes the answer.

const { VERDICT_TOKENS } = backlog_next_report

// Why an issue the ask read was not offered, beside `backlog_wait_cause`'s `chain` and `gate`.
const EXCLUDE_REASON = 'exclude'
const TRIAGE_REASON = 'triage'
const PERSON_REASON = 'person'
const WAIT_REASON = 'wait'
// Offered before the `run:solo` gate and withheld by it — its solo hold, overlap separation or cap.
const SOLO_REASON = 'solo'

// One answer around the `run:solo` gate: `pre_gate` before it, `gated` the answer printed.
interface GateOutcome {
	pre_gate: EpicNextResult
	gated: EpicNextResult
}

function base_of(opted_in: OptedIn, verdict: string): OfferRecord {
	return {
		verdict,
		seen: opted_in.issues.map((issue) => issue.number),
		started: [],
		excluded: [],
		is_unchanged: opted_in.is_unchanged === true,
	}
}

function excluded_by_request(context: PoolContext): Array<OfferExclusion> {
	return context.exclude.map((issue) => ({ issue, reason: EXCLUDE_REASON }))
}

function here(children: ReadonlyArray<EpicChild>, repo: string): ReadonlyArray<EpicChild> {
	return children.filter((child) => child.repo === repo)
}

function numbers_of(children: ReadonlyArray<EpicChild>): Set<number> {
	return new Set(children.map((child) => child.number))
}

// The children the gate moved from offered into `waiting` (`epic_solo`'s withheld).
function withheld_of(outcome: GateOutcome, repo: string): Set<number> {
	const after = numbers_of(backlog_next_report.offered_of(outcome.gated, repo))

	return numbers_of(
		backlog_next_report
			.offered_of(outcome.pre_gate, repo)
			.filter((child) => !after.has(child.number)),
	)
}

function waiting_reason(child: EpicChild, withheld: ReadonlySet<number>): string {
	if (withheld.has(child.number)) return SOLO_REASON

	return backlog_wait_cause.cause_of(child) ?? WAIT_REASON
}

// Each issue of this repository the answer held back, with the first reason that holds it.
function excluded_of(
	context: PoolContext,
	outcome: GateOutcome,
	untriaged: ReadonlyArray<EpicChild>,
): Array<OfferExclusion> {
	const { repo } = context
	const result = outcome.gated
	const withheld = withheld_of(outcome, repo)

	return [
		...excluded_by_request(context),
		...untriaged.map((child) => ({ issue: child.number, reason: TRIAGE_REASON })),
		...here(result.waiting, repo).map((child) => ({
			issue: child.number,
			reason: waiting_reason(child, withheld),
		})),
		...here(result.blocked_on_people, repo).map((child) => ({
			issue: child.number,
			reason: PERSON_REASON,
		})),
	]
}

// The answer's verdict as its tokens say it: `run` when numbers were offered, `triage` when only an
// untriaged candidate was left, otherwise the single word `tokens_of` prints.
function verdict_of(
	result: EpicNextResult,
	repo: string,
	untriaged: ReadonlyArray<EpicChild>,
	started: ReadonlyArray<number>,
): string {
	if (started.length > 0) return VERDICT_TOKENS.run
	if (untriaged.length > 0) return VERDICT_TOKENS.triage

	return backlog_next_report.tokens_of(result, repo).join(',')
}

// An answer decided from the pool: `outcome` around the `run:solo` gate, `untriaged` the candidates
// held for their judgment (`backlog_next_report.report_held`).
async function record_answer(
	context: PoolContext,
	outcome: GateOutcome,
	untriaged: ReadonlyArray<EpicChild>,
): Promise<void> {
	const { gated } = outcome
	const started = backlog_next_report.offered_of(gated, context.repo).map((child) => child.number)

	await lane_ledger_write.record_offer({
		...base_of(context.opted_in, verdict_of(gated, context.repo, untriaged, started)),
		started,
		excluded: excluded_of(context, outcome, untriaged),
	})
}

async function record_retry(context: PoolContext): Promise<void> {
	await lane_ledger_write.record_offer({
		...base_of(context.opted_in, VERDICT_TOKENS.retry),
		excluded: excluded_by_request(context),
	})
}

async function record_none(opted_in: OptedIn): Promise<void> {
	await lane_ledger_write.record_offer(base_of(opted_in, VERDICT_TOKENS.complete))
}

const backlog_next_offer = { record_answer, record_none, record_retry }

export { backlog_next_offer }
