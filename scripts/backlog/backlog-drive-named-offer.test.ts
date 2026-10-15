import { issue_state_cli } from '#scripts/issue/issue-state-cli'
import { expect, test, vi } from 'vitest'
import { backlog_drive, type LoopPorts } from './backlog-drive'
import { backlog_drive_epic } from './backlog-drive-epic'
import { backlog_drive_fixture, type Harness } from './backlog-drive-fixture'
import { backlog_drive_named } from './backlog-drive-named'
import { backlog_drive_named_offer } from './backlog-drive-named-offer'
import { backlog_offer } from './backlog-offer'

const ACTIVE = new Date().toISOString()
const CARRY = {
	invocation: 'backlogrun #1 #2 --max 1',
	started_at: ACTIVE,
	merged: 0,
	filed: 0,
	cuts: 0,
	failures: 0,
	outages: 0,
}
const CONTEXT = { is_only: false, forwarded: ['--max', '1'], owner: String(process.pid) }

test('honors the merged maximum before the second named issue', async () => {
	const carry = { ...CARRY, done: [1], merged: 1 }
	const state = backlog_drive.initial_state([], ACTIVE)
	const offer = await backlog_drive_named_offer.read(carry, state, CONTEXT)

	expect(offer?.verdict).toBe('stop')
})

// joshuafolkken/kit#3558: the loop dispatches a named epic's children itself rather than waking a
// judgment session, and never launches the root.
test('offers a named epic child from the epic instead of launching the root', async () => {
	const state = backlog_drive.initial_state([], ACTIVE)
	const read = vi.spyOn(issue_state_cli, 'read_issue').mockResolvedValue({
		kind: 'state',
		state: { state: 'OPEN', labels: ['epic'], is_human_review: false },
	})
	const epic = vi
		.spyOn(backlog_drive_epic, 'offer')
		.mockResolvedValue({ verdict: 'run', issues: ['7'], retries: 0 })

	const offer = await backlog_drive_named_offer.read(CARRY, state, CONTEXT)

	expect(offer).toMatchObject({ verdict: 'run', issues: ['7'] })
	expect(epic).toHaveBeenCalledWith('1', state, CONTEXT.owner)
	read.mockRestore()
	epic.mockRestore()
})

test('never dispatches a named issue parked with needs-decision, and books it done', async () => {
	const state = backlog_drive.initial_state([], ACTIVE)
	const read = vi.spyOn(issue_state_cli, 'read_issue').mockResolvedValue({
		kind: 'state',
		state: { state: 'OPEN', labels: ['needs-decision'], is_human_review: false },
	})
	const mark_done = vi.spyOn(backlog_drive_named, 'mark_done').mockResolvedValue()

	const offer = await backlog_drive_named_offer.read(CARRY, state, CONTEXT)

	expect(offer).toMatchObject({ verdict: 'wait', issues: [] })
	expect(mark_done).toHaveBeenCalledWith(
		'1',
		expect.objectContaining({ outcome: 'parked' }),
		CONTEXT.owner,
	)
	read.mockRestore()
	mark_done.mockRestore()
})

test('offers the next named issue after the epic root is recorded done', async () => {
	const state = backlog_drive.initial_state([], ACTIVE)
	const read = vi.spyOn(issue_state_cli, 'read_issue').mockResolvedValue({
		kind: 'state',
		state: { state: 'OPEN', labels: [], is_human_review: false },
	})
	const carry = { ...CARRY, done: [1] }
	const context = { ...CONTEXT, forwarded: ['--max', '2'] }
	const offer = await backlog_drive_named_offer.read(carry, state, context)

	expect(offer).toMatchObject({ verdict: 'run', issues: ['2'] })
	read.mockRestore()
})

// joshuafolkken/kit#3739: a failed state read is the driver's to repeat. Only a read that stays failed
// reaches a session, as the `offer` row the loop's table already answers.
const UNREACHABLE = { kind: 'unreadable', reason: 'unreachable', status: 502 } as const
const OPEN_STATE = {
	kind: 'state',
	state: { state: 'OPEN', labels: [], is_human_review: false },
} as const

function named_ports(harness: Harness): LoopPorts {
	return {
		...harness.ports,
		offer: async (state) => await backlog_drive_named_offer.read(CARRY, state, CONTEXT),
	}
}

test('reads a named issue again after a failed state read, then launches it', async () => {
	vi.spyOn(console, 'error').mockImplementation(vi.fn())
	vi.spyOn(issue_state_cli, 'read_issue')
		.mockResolvedValueOnce(UNREACHABLE)
		.mockResolvedValue(OPEN_STATE)
	const harness = backlog_drive_fixture.harness({})
	const ports = named_ports(harness)

	const first = await backlog_drive.run_pass(backlog_drive_fixture.state(), true, ports)
	const second = await backlog_drive.run_pass(first.state, true, ports)

	expect(first).toMatchObject({ kind: 'continue', state: { retries: 1, in_flight: [] } })
	expect(second).toMatchObject({ kind: 'continue', state: { retries: 0, in_flight: ['1'] } })
	expect(harness.calls).toEqual(['launch 1'])
	vi.restoreAllMocks()
})

test('hands back `offer` naming the issue once its state stays unreadable', async () => {
	const error = vi.spyOn(console, 'error').mockImplementation(vi.fn())
	const read = vi.spyOn(issue_state_cli, 'read_issue').mockResolvedValue(UNREACHABLE)
	const harness = backlog_drive_fixture.harness({})
	const state = backlog_drive_fixture.state()

	const end = await backlog_drive.run_loop(
		state,
		backlog_drive_fixture.CONFIG,
		named_ports(harness),
	)

	expect(end).toMatchObject({ reason: 'offer', token: 'offer' })
	expect(read).toHaveBeenCalledTimes(backlog_offer.RETRY_LIMIT)
	expect(error).toHaveBeenLastCalledWith(
		'The state of named issue #1 could not be read (unreachable, status 502); the offer failed 3 times in a row.',
	)
	expect(harness.calls).toEqual([])
	vi.restoreAllMocks()
})

// joshuafolkken/kit#3419: a park is booked done so the run moves on, but it is not a merge — an `--only`
// run whose named issue parked ends as a stop the driver closes with `run:carry --end --stopped`.
const ONLY_CONTEXT = { ...CONTEXT, is_only: true, forwarded: [] }
const DONE_CARRY = {
	...CARRY,
	invocation: 'backlogrun #1 #2 --only',
	done: [1, 2],
	merged_issues: [1],
}

function read_issue_as(state: string): void {
	vi.spyOn(issue_state_cli, 'read_issue').mockResolvedValue({
		kind: 'state',
		state: { state, labels: [], is_human_review: false },
	})
}

test('stops an --only run naming the issue that parked instead of finishing it', async () => {
	read_issue_as('OPEN')
	const state = backlog_drive.initial_state([], ACTIVE)

	const offer = await backlog_drive_named_offer.read(DONE_CARRY, state, ONLY_CONTEXT)

	expect(offer).toMatchObject({
		verdict: 'stop',
		is_finish: false,
		reason: 'only: #2 ended without a merge',
	})
	vi.restoreAllMocks()
})

// joshuafolkken/kit#3433: an issue `run:add` put into the run is held to the same end check.
test('stops an --only run naming an added issue that parked', async () => {
	read_issue_as('OPEN')
	const state = backlog_drive.initial_state([], ACTIVE)
	const carry = {
		...DONE_CARRY,
		done: [1, 2, 3],
		merged_issues: [1, 2],
		added: [{ issue: 3, is_priority: true }],
	}

	const offer = await backlog_drive_named_offer.read(carry, state, ONLY_CONTEXT)

	expect(offer).toMatchObject({
		verdict: 'stop',
		is_finish: false,
		reason: 'only: #3 ended without a merge',
	})
	vi.restoreAllMocks()
})

test('finishes an --only run whose named issues all merged', async () => {
	read_issue_as('CLOSED')
	const state = backlog_drive.initial_state([], ACTIVE)

	const offer = await backlog_drive_named_offer.read(DONE_CARRY, state, ONLY_CONTEXT)

	expect(offer).toMatchObject({ verdict: 'stop', is_finish: true, reason: 'only' })
	vi.restoreAllMocks()
})
