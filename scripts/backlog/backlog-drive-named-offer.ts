import { EPIC_LABEL, has_label_name } from '#scripts/git/issue-labels'
import { issue_state_cli } from '#scripts/issue/issue-state-cli'
import type { RunCarry } from '#scripts/run/run-carry'
import { backlog_budget } from './backlog-budget'
import type { DriveState, OfferRead } from './backlog-drive'
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

async function classify(issue: string, named: OfferRead, owner: string): Promise<OfferRead> {
	const result = await issue_state_cli.read_issue(issue)

	if (result.kind !== 'state') {
		return { verdict: 'issue-state', issues: [], retries: NO_RETRIES }
	}

	if (result.state.state.toUpperCase() === 'CLOSED') {
		await backlog_drive_named.mark_done(issue, { outcome: 'merged', code: 0, token: 'none' }, owner)

		return { verdict: 'wait', issues: [], retries: NO_RETRIES }
	}

	if (has_label_name(result.state.labels, EPIC_LABEL)) {
		return { verdict: `epic #${issue}`, issues: [], retries: NO_RETRIES }
	}

	return named
}

async function read(
	carry: RunCarry,
	state: DriveState,
	context: NamedContext,
): Promise<OfferRead | undefined> {
	const named = backlog_drive_named.offer(carry, state, context.is_only)
	if (named?.verdict !== 'run') return named
	const budget = budget_offer(carry, state, context.forwarded)
	if (budget.verdict !== 'run') return budget
	const [issue] = named.issues

	return issue === undefined ? undefined : await classify(issue, named, context.owner)
}

export const backlog_drive_named_offer = { read }
