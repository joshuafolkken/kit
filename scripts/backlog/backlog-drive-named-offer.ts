import { auto_ok_cli } from '#scripts/auto-ok/auto-ok-cli'
import { issue_cite } from '#scripts/issue/issue-cite'
import {
	EPIC_LABEL,
	has_label_name,
	has_parked_label,
	parked_label_of,
} from '#scripts/issue/issue-labels'
import type { IssueState } from '#scripts/issue/issue-state'
import { issue_state_cli } from '#scripts/issue/issue-state-cli'
import { lane_plan } from '#scripts/lane/lane-plan'
import { lane_plan_probe } from '#scripts/lane/lane-plan-probe'
import type { RunCarry } from '#scripts/run/carry/run-carry'
import { backlog_budget } from './backlog-budget'
import type { DriveState, OfferRead } from './backlog-drive'
import { backlog_drive_epic } from './backlog-drive-epic'
import { backlog_drive_named } from './backlog-drive-named'
import { backlog_drive_rate_limit } from './backlog-drive-rate-limit'
import { backlog_drive_stalled_retry } from './backlog-drive-stalled-retry'
import { backlog_drive_unread } from './backlog-drive-unread'
import type { Declared } from './backlog-overlap'
import { backlog_plan_comment, type PoolIssue } from './backlog-plan-comment'

interface NamedContext {
	is_only: boolean
	forwarded: ReadonlyArray<string>
	owner: string
}

interface NamedRead {
	offer: OfferRead | undefined
	pool: DriveState
}

interface NamedPass {
	offer: OfferRead | undefined
	passed: ReadonlyArray<string>
}

const NO_RETRIES = 0

function max_of(forwarded: ReadonlyArray<string>): number | undefined {
	const index = forwarded.indexOf('--max')

	return index === -1 ? undefined : Number(forwarded[index + 1])
}

function budget_offer(
	carry: RunCarry,
	state: DriveState,
	forwarded: ReadonlyArray<string>,
): OfferRead {
	const budget = backlog_budget.decide({
		answer: 'candidates',
		merged: carry.merged,
		running: state.in_flight.length,
		started_at_ms: Date.parse(carry.started_at),
		active_at_ms: Date.parse(state.active),
		now_ms: Date.now(),
		max_issues: max_of(forwarded),
		idle_budget_ms: backlog_budget.DEFAULT_IDLE_MS,
	})

	return {
		verdict: budget.verdict,
		issues: [],
		retries: NO_RETRIES,
		reason: budget.reason,
		is_finish: budget.verdict === 'stop',
	}
}

// Whether a named issue has already settled without this run dispatching it: closed is merged, and a
// park (`PARKED_LABELS`) waits on a person, so re-dispatching it only repeats the stop it parked on.
// Either is booked done rather than offered.
function is_settled(state: IssueState): boolean {
	return state.state.toUpperCase() === 'CLOSED' || has_parked_label(state.labels)
}

async function classify(
	issue: string,
	named: OfferRead,
	state: DriveState,
	owner: string,
): Promise<OfferRead> {
	const result = await issue_state_cli.read_issue(issue)

	if (result.kind !== 'state') return backlog_drive_unread.offer(issue, result, state.retries)

	if (is_settled(result.state)) {
		await backlog_drive_named.mark_settled(issue, owner)

		return { verdict: 'wait', issues: [], retries: NO_RETRIES }
	}

	return has_label_name(result.state.labels, EPIC_LABEL)
		? await backlog_drive_epic.offer(issue, state, owner)
		: named
}

// **A named issue booked done is not thereby merged**: a park and a failure are
// booked done too, so the run moves past them. One the run's own merges did not record and GitHub does
// not read as closed ended without a merge — and an unreadable state counts as that, because a false
// stop reaches a person while a false finish ends the run where nobody sees it. The answer is why it
// did not merge (joshuafolkken/kit#4746): the park it sits on, or that it is open without one.
async function unmerged_reason(
	issue: number,
	merged: ReadonlyArray<number>,
): Promise<string | undefined> {
	if (merged.includes(issue)) return undefined

	const result = await issue_state_cli.read_issue(String(issue))

	if (result.kind !== 'state') return 'state unreadable'
	if (result.state.state.toUpperCase() === 'CLOSED') return undefined

	return parked_label_of(result.state.labels) ?? 'open'
}

function cite(issue: number, reason: string | undefined): string | undefined {
	return reason === undefined ? undefined : `${issue_cite.plain_for('program', issue)} (${reason})`
}

// Each named issue that did not merge, with its reason. The issues `run:add` put in count too: one that
// parked is no more a merge than a declared one.
async function unmerged_of(carry: RunCarry): Promise<Array<string>> {
	const declared = backlog_drive_named.named_issues(carry)
	const merged = carry.merged_issues ?? []
	const reasons = await Promise.all(
		declared.map(async (issue) => await unmerged_reason(issue, merged)),
	)
	const cited = declared.map((issue, index) => cite(issue, reasons[index]))

	return cited.filter((line) => line !== undefined)
}

// The `--only` run's end: a finish when every named issue merged, otherwise a stop naming the ones that
// did not, which `backlog-drive-finish.ts` closes with `run:carry --end --stopped` and its ⏸️ notice.
async function only_end(carry: RunCarry, named: OfferRead): Promise<OfferRead> {
	const unmerged = await unmerged_of(carry)

	if (unmerged.length === 0) return named

	return {
		...named,
		reason: `only: ${unmerged.join(', ')} ended without a merge`,
		is_finish: false,
	}
}

async function not_run(
	carry: RunCarry,
	named: OfferRead | undefined,
): Promise<OfferRead | undefined> {
	return named?.is_finish === true ? await only_end(carry, named) : named
}

// What `numbers` declare — recorded plan, else plan comment, else body, the scope `lane:plan` and
// `backlog:next` read; a plan comment posted after the record wins (joshuafolkken/kit#6798). An issue
// `listed` does not carry, or an unread listing, declares its plan alone.
async function declared_among(
	numbers: ReadonlyArray<number>,
	listed: ReadonlyArray<PoolIssue>,
): Promise<Declared> {
	const pool = [...new Set(numbers)].map(
		(number) => listed.find((issue) => issue.number === number) ?? { number },
	)

	return await backlog_plan_comment.declared_of(pool, process.cwd())
}

// The issues in flight, with each named one whose yielded plan — or the plan comment fixed since it
// (joshuafolkken/kit#6798) — a running lane still holds. A running lane is one in flight or one the
// listing carries `in-progress`, the holders `lane:plan`'s probe yields to (`lane-plan-probe.ts`), so a
// lane outside this run holds too (joshuafolkken/kit#6800). The offer waits on it as on a lane, so the
// run does not relaunch it into the same yield (joshuafolkken/kit#4926), and offers it again once the
// holder's lane ends and drops its `in-progress`. The listing is read only when a named issue yielded.
async function holding(carry: RunCarry, in_flight: ReadonlyArray<string>): Promise<Array<string>> {
	const yielded = backlog_drive_named
		.named_issues(carry)
		.filter((issue) => lane_plan.is_yielded(issue, process.cwd()))
	if (yielded.length === 0) return [...in_flight]
	const listing = await auto_ok_cli.fetch_opted_in()
	const listed = listing.kind === 'read' ? listing.issues : []
	const running = lane_plan_probe.running_of(listed).map((issue) => issue.number)
	const declared = await declared_among([...in_flight.map(Number), ...running], listed)
	const scopes = await declared_among(yielded, listed)
	const held = yielded.filter((issue) =>
		lane_plan.is_yield_held(issue, declared, process.cwd(), scopes.get(issue)),
	)

	return [...new Set([...in_flight, ...held.map(String)])]
}

// A named launch waits for the reset while the GitHub core allowance is below the floor, before it reads
// the issue's state (joshuafolkken/kit#6729). Only a launch reads the allowance: a wait or the run's end
// starts nothing.
async function launch(
	issue: string | undefined,
	named: OfferRead,
	state: DriveState,
	owner: string,
): Promise<OfferRead | undefined> {
	if (issue === undefined) return undefined

	const held = await backlog_drive_rate_limit.held(state)

	return held ?? (await classify(issue, named, state, owner))
}

// An epic `run:add` put in that waits on its children holds nothing up, like an added issue in flight
// (joshuafolkken/kit#6883): its children are what runs, so the offer passes it as in flight and the
// issues behind it, or the pool, fill the free lanes (joshuafolkken/kit#6840). The pool counts it
// running, so with no lane of the run's own in flight it does not read the drain while the epic is
// open. A failed read still waits (`retries`), so the epic's retry count reaches its hand-back.
function is_passed(
	carry: RunCarry,
	issue: string | undefined,
	offered: OfferRead | undefined,
): issue is string {
	if (issue === undefined || offered?.verdict !== 'wait') return false

	return offered.retries === NO_RETRIES && !backlog_drive_named.is_declared(carry, issue)
}

async function offer_of(
	carry: RunCarry,
	state: DriveState,
	waiting: DriveState,
	context: NamedContext,
): Promise<NamedPass> {
	const named = backlog_drive_named.offer(carry, waiting, context.is_only)
	if (named?.verdict !== 'run') return { offer: await not_run(carry, named), passed: [] }
	const budget = budget_offer(carry, state, context.forwarded)
	if (budget.verdict !== 'run') return { offer: budget, passed: [] }
	const [issue] = named.issues
	const offered = await launch(issue, named, state, context.owner)
	if (!is_passed(carry, issue, offered)) return { offer: offered, passed: [] }
	const past = await offer_of(
		carry,
		state,
		{ ...waiting, in_flight: [...waiting.in_flight, issue] },
		context,
	)

	return { ...past, passed: [issue, ...past.passed] }
}

// A named issue the yield holds while none of the run's own lanes runs — its holder is outside the run
// (joshuafolkken/kit#6800). The pool's offer would read nothing running as the drain and end the run
// before the issue is offered again (`backlog-offer-cli.ts` → `mark_drain`), so the run waits on it.
function held_alone(state: DriveState, waiting: DriveState): OfferRead | undefined {
	if (state.in_flight.length > 0 || waiting.in_flight.length === 0) return undefined

	return { verdict: 'wait', issues: [], retries: NO_RETRIES }
}

// The named offer, and the state the pool's offer reads when it names nothing: a named issue the yield
// still holds is excluded there too, so the pool does not relaunch it into the same yield
// (joshuafolkken/kit#4926, joshuafolkken/kit#6883). It is excluded, not counted running: no lane holds it.
// An added epic the offer passed is counted running there (`is_passed`).
// joshuafolkken/kit#6865: each offer first retries the mechanical parks whose stop has cleared.
async function read(carry: RunCarry, state: DriveState, context: NamedContext): Promise<NamedRead> {
	await backlog_drive_stalled_retry.sweep()
	const waiting = { ...state, in_flight: await holding(carry, state.in_flight) }
	const { offer, passed } = await offer_of(carry, state, waiting, context)
	const pool = {
		...state,
		in_flight: [...state.in_flight, ...passed],
		exclude: [...state.exclude, ...waiting.in_flight],
	}

	return { offer: offer ?? held_alone(state, waiting), pool }
}

export const backlog_drive_named_offer = { read }
