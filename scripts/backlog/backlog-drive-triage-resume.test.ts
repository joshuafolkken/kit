import { expect, it, vi } from 'vitest'
import { backlog_drive, type DriveState } from './backlog-drive'
import { backlog_drive_args } from './backlog-drive-args'
import { backlog_drive_cli } from './backlog-drive-cli'
import { backlog_drive_fixture } from './backlog-drive-fixture'

const { FIRST_CHILD, SECOND_CHILD, harness, state } = backlog_drive_fixture
const OWNER = '4242'
const RESUME_PREFIX = 'resume: '

function restored_state(current: DriveState): DriveState {
	const context = backlog_drive_args.parse(['--owner', OWNER])

	if (context === undefined) throw new Error('Missing owner context')

	const line = backlog_drive_args.resume_line(current, context)
	const resumed = backlog_drive_args.parse(line.slice(RESUME_PREFIX.length).split(' '))

	if (resumed === undefined) throw new Error('Invalid resume line')

	const left_out = { exclude: [...resumed.exclude], waiting: [] }

	return backlog_drive_cli.seeded_state({ lanes: current.in_flight, left_out }, resumed)
}

async function interrupted_state(token: string): Promise<DriveState> {
	const children = [FIRST_CHILD, SECOND_CHILD]
	const { ports } = harness({ finished: children, parked: [FIRST_CHILD] })
	const { merge } = ports

	ports.merge = vi.fn(async (issue): ReturnType<typeof merge> =>
		issue === SECOND_CHILD ? { token, outcome: 'failed', is_offer: false } : await merge(issue),
	)
	const interrupted = await backlog_drive.run_pass(state(children), true, ports)
	const resumed = restored_state(interrupted.state)

	expect(interrupted.kind === 'end' && interrupted.end.reason).toBe('merge')
	expect(resumed.is_triage_owed).toBe(true)

	return resumed
}

it.each(['retry', ''])(
	'retains pending triage across an interrupted collection: %s',
	async (token) => {
		const resumed = await interrupted_state(token)
		const { ports } = harness({ finished: [SECOND_CHILD] })
		const triage = await backlog_drive.run_pass(resumed, true, ports)
		const completed = restored_state(triage.state)
		const next = await backlog_drive.run_pass(completed, true, ports)

		expect(triage.kind === 'end' && triage.end.token).toBe('triage')
		expect(completed.is_triage_owed).not.toBe(true)
		expect(next.kind).toBe('continue')
	},
)

it('keeps a stopping run stopped while triage is pending', async () => {
	const { ports } = harness({ finished: [FIRST_CHILD], parked: [FIRST_CHILD] })
	const result = await backlog_drive.run_pass(
		{ ...state([FIRST_CHILD]), is_stopping: true },
		true,
		ports,
	)

	expect(result.kind === 'end' && result.end.token).toBe('stop')
})
