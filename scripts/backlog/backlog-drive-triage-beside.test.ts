import { process_identity } from '#scripts/josh/process-identity'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { backlog_drive, type DriveState } from './backlog-drive'
import { backlog_drive_args, type DriveContext } from './backlog-drive-args'
import { backlog_drive_cli } from './backlog-drive-cli'
import { backlog_drive_fixture } from './backlog-drive-fixture'

// joshuafolkken/kit#7120: the judgment session runs beside the driver, which keeps collecting and
// filling lanes while it lives and hands the next owed triage back once it has ended.

const { FIRST_CHILD, OFFERED, SECOND_CHILD, harness, offer, state } = backlog_drive_fixture
const TRIAGE_PID = 4242
const OWNER = '1'
const RESUME_PREFIX = 'resume: '
const SESSION_START = 'Tue Nov  9 09:00:00 2026'

afterEach(() => {
	vi.restoreAllMocks()
})

function beside(in_flight: ReadonlyArray<string>, is_live: boolean): DriveState {
	vi.spyOn(process_identity, 'is_same_process').mockReturnValue(is_live)

	return { ...state(in_flight), triage_pid: TRIAGE_PID }
}

describe('backlog_drive — a triage session beside the driver', () => {
	it('collects a park and launches the offered issue without ending the pass', async () => {
		const { ports, calls } = harness({
			finished: [FIRST_CHILD],
			parked: [FIRST_CHILD],
			offers: [offer('run', [OFFERED])],
		})
		const result = await backlog_drive.run_pass(
			beside([FIRST_CHILD, SECOND_CHILD], true),
			false,
			ports,
		)

		expect(calls).toStrictEqual([`merge ${FIRST_CHILD}`, 'offer', `launch ${OFFERED}`])
		expect(result.kind).toBe('continue')
		expect(result.state).toMatchObject({ is_triage_owed: true, triage_pid: TRIAGE_PID })
	})

	it('holds a stop answer while the session lives', async () => {
		const { ports, calls } = harness({ offers: [offer('stop')] })
		const result = await backlog_drive.run_pass(beside([SECOND_CHILD], true), true, ports)

		expect(calls).toStrictEqual(['offer'])
		expect(result.kind).toBe('continue')
	})

	it('hands the owed triage back once the session has ended', async () => {
		const { ports } = harness({ offers: [offer('watch')] })
		const owed = { ...beside([SECOND_CHILD], false), is_triage_owed: true }
		const result = await backlog_drive.run_pass(owed, true, ports)

		expect(result.kind === 'end' && result.end.token).toBe('triage')
		expect(result.state.triage_pid).toBeUndefined()
	})
})

// joshuafolkken/kit#7506: a drain's retrospective session runs beside the driver, so the drain is not
// handed back again and an issue filed meanwhile is dispatched before the session has ended.
describe('backlog_drive — a retrospective session beside the driver', () => {
	it('dispatches an issue filed after a drain while its retrospective session runs', async () => {
		const drained = { ...offer('watch'), answer: 'exhausted', is_retrospective_owed: true }
		const { ports, calls } = harness({ offers: [drained, offer('run', [OFFERED])] })
		const held = await backlog_drive.run_pass(beside([], true), true, ports)
		const next = await backlog_drive.run_pass(held.state, true, ports)

		expect(held.kind).toBe('continue')
		expect(next.kind).toBe('continue')
		expect(calls).toStrictEqual(['offer', 'offer', `launch ${OFFERED}`])
	})
})

// The context the next driver run reads back from the resume line `named` writes.
function resumed(named: DriveState): DriveContext {
	const context = backlog_drive_args.parse(['--owner', OWNER])
	if (context === undefined) throw new Error('Missing owner context')

	const line = backlog_drive_args.resume_line(named, context)
	const read = backlog_drive_args.parse(line.slice(RESUME_PREFIX.length).split(' '))
	if (read === undefined) throw new Error('Unreadable resume line')

	return read
}

describe('backlog_drive_args — --triage-pid', () => {
	it('carries the session pid through the resume line', () => {
		expect(resumed({ ...state(), triage_pid: TRIAGE_PID }).triage_pid).toBe(TRIAGE_PID)
	})

	it('carries a start time with spaces through the resume line', () => {
		const named = { ...state(), triage_pid: TRIAGE_PID, triage_start: SESSION_START }

		expect(resumed(named).triage_start).toBe(SESSION_START)
	})

	it('seeds the resumed driver state with the session it names', () => {
		const named = { ...state(), triage_pid: TRIAGE_PID, triage_start: SESSION_START }
		const seeded = backlog_drive_cli.seeded_state(
			{ lanes: [], left_out: { exclude: [], waiting: [] } },
			resumed(named),
		)

		expect(seeded).toMatchObject({ triage_pid: TRIAGE_PID, triage_start: SESSION_START })
	})

	it('refuses a pid that is not a count', () => {
		expect(backlog_drive_args.parse(['--owner', OWNER, '--triage-pid', 'none'])).toBeUndefined()
	})
})
