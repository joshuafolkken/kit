import { issue_cite } from '#scripts/issue/issue-cite'
import { parked_label_of } from '#scripts/issue/issue-labels'
import { issue_state_cli } from '#scripts/issue/issue-state-cli'
import { lane_plan } from '#scripts/lane/lane-plan'
import { lane_plan_probe } from '#scripts/lane/lane-plan-probe'
import { cli_flags } from '#scripts/lib/cli-flags'
import type { RunCarry } from '#scripts/run/carry/run-carry'
import { backlog_budget, type BacklogAnswer } from './backlog-budget'
import { backlog_budget_cli } from './backlog-budget-cli'
import type { DriveState, OfferRead } from './backlog-drive'
import { backlog_drive_named } from './backlog-drive-named'
import { backlog_drive_named_launch } from './backlog-drive-named-launch'
import { backlog_drive_named_scope } from './backlog-drive-named-scope'
import { backlog_drive_stalled_retry } from './backlog-drive-stalled-retry'

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

function value_of(forwarded: ReadonlyArray<string>, flag: string): string | undefined {
	const index = forwarded.indexOf(flag)

	return index === -1 ? undefined : forwarded[index + 1]
}

function max_of(forwarded: ReadonlyArray<string>): number | undefined {
	const value = value_of(forwarded, '--max')

	return value === undefined ? undefined : Number(value)
}

// The idle watch `--idle <n>` asked for, read the way `backlog:budget` reads it: omitted is the
// default, `0` turns it off.
function idle_of(forwarded: ReadonlyArray<string>): number | undefined {
	return backlog_budget_cli.to_idle_ms(cli_flags.to_count(value_of(forwarded, '--idle')))
}

function budget_offer(
	carry: RunCarry,
	state: DriveState,
	forwarded: ReadonlyArray<string>,
	answer: BacklogAnswer = 'candidates',
): OfferRead {
	const budget = backlog_budget.decide({
		answer,
		merged: carry.merged,
		running: state.in_flight.length,
		started_at_ms: Date.parse(carry.started_at),
		active_at_ms: Date.parse(state.active),
		now_ms: Date.now(),
		max_issues: max_of(forwarded),
		idle_budget_ms: idle_of(forwarded),
	})

	return {
		verdict: budget.verdict,
		issues: [],
		retries: NO_RETRIES,
		reason: budget.reason,
		is_finish: budget.verdict === 'stop',
	}
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

// A bare `--only` with nothing left to run watches for what `run:add` puts in, under the idle watch an
// empty pool gets (`exhausted`), and never offers the pool (joshuafolkken/kit#8923).
function only_idle(
	carry: RunCarry,
	state: DriveState,
	context: NamedContext,
): OfferRead | undefined {
	return context.is_only ? budget_offer(carry, state, context.forwarded, 'exhausted') : undefined
}

async function not_run(
	carry: RunCarry,
	state: DriveState,
	named: OfferRead | undefined,
	context: NamedContext,
): Promise<OfferRead | undefined> {
	const ended = named ?? only_idle(carry, state, context)

	return ended?.is_finish === true ? await only_end(carry, ended) : ended
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
	const listed = await backlog_drive_named_scope.listed()
	const running = lane_plan_probe.running_of(listed).map((issue) => issue.number)
	const declared = await backlog_drive_named_scope.declared_among(
		[...in_flight.map(Number), ...running],
		listed,
	)
	const scopes = await backlog_drive_named_scope.declared_among(yielded, listed)
	const stops = lane_plan_probe.stops_of(listed)
	const held = yielded.filter((issue) =>
		lane_plan.is_yield_held(issue, declared, process.cwd(), { scope: scopes.get(issue), stops }),
	)

	return [...new Set([...in_flight, ...held.map(String)])]
}

// When every named issue left is passed, the run's end or the pool is read past them, as though in flight.
async function past_passed(
	carry: RunCarry,
	state: DriveState,
	waiting: DriveState,
	context: NamedContext,
): Promise<OfferRead | undefined> {
	const named = backlog_drive_named.offer(carry, waiting, context.is_only)

	return await not_run(carry, state, named, context)
}

// The gathered issues the run's maximum still has room for: offered side by side, the named issues
// would otherwise start past `--max` (joshuafolkken/kit#8953). The budget already answered `run`, so
// the room is at least one.
function capped(
	offer: OfferRead,
	carry: RunCarry,
	state: DriveState,
	forwarded: ReadonlyArray<string>,
): OfferRead {
	const max = max_of(forwarded)
	if (max === undefined || offer.verdict !== 'run') return offer

	return { ...offer, issues: offer.issues.slice(0, max - carry.merged - state.in_flight.length) }
}

async function offer_of(
	carry: RunCarry,
	state: DriveState,
	waiting: DriveState,
	context: NamedContext,
): Promise<NamedPass> {
	const named = backlog_drive_named.offer(carry, waiting, context.is_only)

	if (named?.verdict !== 'run') {
		return { offer: await not_run(carry, state, named, context), passed: [] }
	}

	const budget = budget_offer(carry, state, context.forwarded)
	if (budget.verdict !== 'run') return { offer: budget, passed: [] }
	const gathered = await backlog_drive_named_launch.gather(
		named.issues,
		state,
		context.owner,
		carry,
	)

	if (gathered.offer !== undefined) {
		return { ...gathered, offer: capped(gathered.offer, carry, state, context.forwarded) }
	}

	const passed = { ...waiting, in_flight: [...waiting.in_flight, ...gathered.passed] }

	return { offer: await past_passed(carry, state, passed, context), passed: gathered.passed }
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
// An added epic, or a blocked added issue, the offer passed is counted running there (`is_passed`).
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
