import { issue_cite } from '#scripts/issue/issue-cite'
import { EPIC_LABEL, has_label_name, NEEDS_DECISION_LABEL } from '#scripts/issue/issue-labels'
import type { IssueState } from '#scripts/issue/issue-state'
import { issue_state_cli } from '#scripts/issue/issue-state-cli'
import type { RunCarry } from '#scripts/run/carry/run-carry'
import { run_carry_added } from '#scripts/run/carry/run-carry-added'
import type { MergeResult } from '#scripts/run/merge/run-merge-cli'
import { run_invocation } from '#scripts/run/run-invocation'
import { backlog_budget } from './backlog-budget'
import type { DriveState, OfferRead } from './backlog-drive'
import { backlog_drive_epic } from './backlog-drive-epic'
import { backlog_drive_named } from './backlog-drive-named'

interface NamedContext {
	is_only: boolean
	forwarded: ReadonlyArray<string>
	owner: string
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

// The outcome a named issue has already reached without this run dispatching it: closed is merged, and
// a `needs-decision` park waits on a person, so re-dispatching it only repeats the stop it parked on.
// Either is booked done rather than offered.
function settled_outcome(state: IssueState): MergeResult['outcome'] | undefined {
	if (state.state.toUpperCase() === 'CLOSED') return 'merged'

	return has_label_name(state.labels, NEEDS_DECISION_LABEL) ? 'parked' : undefined
}

async function classify(
	issue: string,
	named: OfferRead,
	state: DriveState,
	owner: string,
): Promise<OfferRead> {
	const result = await issue_state_cli.read_issue(issue)

	if (result.kind !== 'state') return { verdict: 'issue-state', issues: [], retries: NO_RETRIES }

	const outcome = settled_outcome(result.state)

	if (outcome !== undefined) {
		await backlog_drive_named.mark_done(issue, { outcome, code: 0, token: 'none' }, owner)

		return { verdict: 'wait', issues: [], retries: NO_RETRIES }
	}

	return has_label_name(result.state.labels, EPIC_LABEL)
		? await backlog_drive_epic.offer(issue, state, owner)
		: named
}

// **A named issue booked done is not thereby merged**: a park and a failure are
// booked done too, so the run moves past them. One the run's own merges did not record and GitHub does
// not read as closed ended without a merge — and an unreadable state counts as that, because a false
// stop reaches a person while a false finish ends the run where nobody sees it.
async function is_unmerged(issue: number, merged: ReadonlyArray<number>): Promise<boolean> {
	if (merged.includes(issue)) return false

	const result = await issue_state_cli.read_issue(String(issue))

	return result.kind !== 'state' || result.state.state.toUpperCase() !== 'CLOSED'
}

// The issues `run:add` put in count too: one that parked is no more a merge
// than a declared one.
async function unmerged_of(carry: RunCarry): Promise<Array<number>> {
	const declared = run_carry_added.ordered(
		run_invocation.issue_numbers(carry.invocation) ?? [],
		carry.added,
	)
	const merged = carry.merged_issues ?? []
	const flags = await Promise.all(declared.map(async (issue) => await is_unmerged(issue, merged)))

	return declared.filter((_, index) => flags[index] === true)
}

// The `--only` run's end: a finish when every named issue merged, otherwise a stop naming the ones that
// did not, which `backlog-drive-finish.ts` closes with `run:carry --end --stopped` and its ⏸️ notice.
async function only_end(carry: RunCarry, named: OfferRead): Promise<OfferRead> {
	const unmerged = await unmerged_of(carry)

	if (unmerged.length === 0) return named

	const listed = unmerged.map((issue) => issue_cite.plain(issue)).join(', ')

	return { ...named, reason: `only: ${listed} ended without a merge`, is_finish: false }
}

async function not_run(
	carry: RunCarry,
	named: OfferRead | undefined,
): Promise<OfferRead | undefined> {
	return named?.is_finish === true ? await only_end(carry, named) : named
}

async function read(
	carry: RunCarry,
	state: DriveState,
	context: NamedContext,
): Promise<OfferRead | undefined> {
	const named = backlog_drive_named.offer(carry, state, context.is_only)
	if (named?.verdict !== 'run') return await not_run(carry, named)
	const budget = budget_offer(carry, state, context.forwarded)
	if (budget.verdict !== 'run') return budget
	const [issue] = named.issues

	return issue === undefined ? undefined : await classify(issue, named, state, context.owner)
}

export const backlog_drive_named_offer = { read }
