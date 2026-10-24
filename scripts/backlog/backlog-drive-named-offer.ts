import { issue_cite } from '#scripts/issue/issue-cite'
import {
	EPIC_LABEL,
	has_label_name,
	has_parked_label,
	parked_label_of,
} from '#scripts/issue/issue-labels'
import type { IssueState } from '#scripts/issue/issue-state'
import { issue_state_cli } from '#scripts/issue/issue-state-cli'
import type { RunCarry } from '#scripts/run/carry/run-carry'
import { backlog_budget } from './backlog-budget'
import type { DriveState, OfferRead } from './backlog-drive'
import { backlog_drive_epic } from './backlog-drive-epic'
import { backlog_drive_named } from './backlog-drive-named'
import { backlog_drive_unread } from './backlog-drive-unread'

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
	return reason === undefined ? undefined : `${issue_cite.plain(issue)} (${reason})`
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
