import type { IssueState } from '#scripts/issue/issue-state'
import { issue_state_cli, type StateRead } from '#scripts/issue/issue-state-cli'
import { lane_dispatch_dependency } from '#scripts/lane/lane-dispatch-dependency'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { backlog_drive, type OfferRead } from './backlog-drive'
import { backlog_drive_epic } from './backlog-drive-epic'
import { backlog_drive_named } from './backlog-drive-named'
import { backlog_drive_named_gate } from './backlog-drive-named-gate'
import { backlog_drive_named_launch } from './backlog-drive-named-launch'
import { backlog_drive_rate_limit } from './backlog-drive-rate-limit'

// joshuafolkken/kit#8953: every named issue left is gathered into one offer, in the typed order; one
// that waits with no retry owed is passed rather than holding the rest up.

const ACTIVE = new Date().toISOString()
const OWNER = String(process.pid)
const STATE = backlog_drive.initial_state([], ACTIVE)
const EPIC = '20'
const BLOCKED = '21'
const WAIT: OfferRead = { verdict: 'wait', issues: [], retries: 0 }

function issue_state(state: string, labels: ReadonlyArray<string> = []): StateRead {
	const read: IssueState = { state, labels, is_human_review: false }

	return { kind: 'state', state: read }
}

function states(reads: Readonly<Record<string, StateRead>>): void {
	vi.spyOn(issue_state_cli, 'read_issue').mockImplementation(
		async (issue) => await (reads[issue] ?? issue_state('OPEN')),
	)
}

async function gather(
	issues: ReadonlyArray<string>,
): ReturnType<typeof backlog_drive_named_launch.gather> {
	return await backlog_drive_named_launch.gather(issues, STATE, OWNER)
}

beforeEach(() => {
	vi.spyOn(backlog_drive_rate_limit, 'held').mockResolvedValue(undefined)
	vi.spyOn(lane_dispatch_dependency, 'unfinished').mockImplementation(
		async (issue) =>
			await (issue === BLOCKED
				? [{ number: 1, repo: 'r', state: 'OPEN', labels: [], blocked_by: [] }]
				: []),
	)
	vi.spyOn(backlog_drive_named_gate, 'admitted').mockImplementation(
		async (plain) => await plain.map((issue) => issue.number),
	)
	states({})
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('backlog_drive_named_launch.gather — the issues run together', () => {
	it('offers every plain issue at once, in the typed order', async () => {
		expect(await gather(['3', '1', '2'])).toStrictEqual({
			offer: { verdict: 'run', issues: ['3', '1', '2'], retries: 0 },
			passed: [],
		})
	})

	it('passes an epic waiting on its children and runs the issue behind it', async () => {
		states({ [EPIC]: issue_state('OPEN', ['epic']) })
		vi.spyOn(backlog_drive_epic, 'offer').mockResolvedValue(WAIT)

		expect(await gather([EPIC, '2'])).toStrictEqual({
			offer: { verdict: 'run', issues: ['2'], retries: 0 },
			passed: [EPIC],
		})
	})

	it('hands the gate each plain issue with its labels', async () => {
		states({ 1: issue_state('OPEN', ['run:solo']) })
		const admitted = vi.spyOn(backlog_drive_named_gate, 'admitted')

		await gather(['1', '2'])

		expect(admitted).toHaveBeenCalledWith(
			[
				{ number: 1, labels: ['run:solo'] },
				{ number: 2, labels: [] },
			],
			[],
		)
	})
})

describe('backlog_drive_named_launch.gather — an issue that holds nothing up', () => {
	it('passes an issue whose blockers are unfinished', async () => {
		expect(await gather([BLOCKED, '2'])).toMatchObject({
			offer: { verdict: 'run', issues: ['2'] },
			passed: [BLOCKED],
		})
	})

	it('books a settled issue done and passes it', async () => {
		states({ 1: issue_state('CLOSED'), 2: issue_state('OPEN', ['needs-decision']) })
		const settled = vi.spyOn(backlog_drive_named, 'mark_settled').mockResolvedValue()

		expect(await gather(['1', '2', '3'])).toMatchObject({
			offer: { verdict: 'run', issues: ['3'] },
			passed: ['1', '2'],
		})
		expect(settled.mock.calls).toStrictEqual([
			['1', OWNER],
			['2', OWNER],
		])
	})
})

describe('backlog_drive_named_launch.gather — nothing runs', () => {
	it('stops at a failed state read, so its retry count reaches the hand-back', async () => {
		vi.spyOn(console, 'error').mockImplementation(vi.fn())
		states({ 1: { kind: 'unreadable' } })

		expect(await gather(['1'])).toStrictEqual({
			offer: { verdict: 'wait', issues: [], retries: 1 },
			passed: [],
		})
	})

	it('waits for the rate-limit reset before reading any state', async () => {
		const held: OfferRead = { ...WAIT, not_before_ms: 1 }

		vi.spyOn(backlog_drive_rate_limit, 'held').mockResolvedValue(held)
		const read = vi.spyOn(issue_state_cli, 'read_issue')

		expect(await gather(['1'])).toStrictEqual({ offer: held, passed: [] })
		expect(read).not.toHaveBeenCalled()
	})

	it('waits when the gate withholds every issue', async () => {
		vi.spyOn(backlog_drive_named_gate, 'admitted').mockResolvedValue([])

		expect(await gather(['1', '2'])).toStrictEqual({ offer: WAIT, passed: [] })
	})

	it('offers nothing when every issue is passed', async () => {
		expect(await gather([BLOCKED])).toStrictEqual({ offer: undefined, passed: [BLOCKED] })
	})
})
