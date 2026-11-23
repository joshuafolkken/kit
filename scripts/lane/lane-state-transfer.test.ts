import { repository_lock } from '#scripts/git/repository-lock'
import { stamp_file } from '#scripts/josh/stamp-file'
import { run_carry } from '#scripts/run/carry/run-carry'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { lane_state, type OwnerMove, type RecordOutcome } from './lane-state'

// joshuafolkken/kit#8455: a run that adopts a lane its ended owner left behind takes the record over.
// joshuafolkken/kit#8768: the hand-over is the table's event, keeping the state and who paused it.

const make_directory = temporary_directory()

const ISSUE = '8455'
const DISPATCH = 'lane:dispatch'
const PAUSE = 'lane:pause'
const EARLIER_START = new Date('2026-11-21T04:00:00.000Z')
const LAUNCHED_AT = new Date('2026-11-21T04:17:00.000Z')
const CURRENT_START = new Date('2026-11-21T09:00:00.000Z')
const ADOPTED_AT = new Date('2026-11-21T09:05:00.000Z')
const EARLIER_OWNER = 12_844
const CURRENT_OWNER = 56_029
const CURRENT_RUN = { started_at: CURRENT_START.toISOString(), owner_pid: CURRENT_OWNER }
const NOTHING_TO_TRANSFER = { kind: 'skipped', reason: 'no record or run' }

const state = { directory: '' }

function write_carry(started: Date, pid: number): void {
	const carry = run_carry.fresh_carry('backlogrun', { pid }, started)

	stamp_file.replace_stamp(run_carry.carry_path(state.directory), carry)
}

async function launch_under_earlier_run(): Promise<void> {
	write_carry(EARLIER_START, EARLIER_OWNER)
	await lane_state.record_change(
		{ issue: ISSUE, state: 'running', command: DISPATCH, is_launch: true },
		{ directory: state.directory, now: LAUNCHED_AT },
	)
}

async function transfer(move: OwnerMove = 'hand-over'): Promise<RecordOutcome> {
	return await lane_state.record_owner(ISSUE, move, { directory: state.directory, now: ADOPTED_AT })
}

async function pause_by_person(): Promise<void> {
	await lane_state.record_change(
		{ issue: ISSUE, state: 'paused', command: PAUSE },
		{ directory: state.directory, now: LAUNCHED_AT },
	)
}

beforeEach(() => {
	state.directory = make_directory('lane-state-transfer-')
	vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
	stamp_file.remove_stamp(run_carry.carry_path(state.directory))
	stamp_file.remove_stamp(lane_state.state_path(state.directory, ISSUE))
	vi.restoreAllMocks()
})

describe('lane_state.record_owner hand-over', () => {
	it('hands the record to the current run, keeping its state and launch', async () => {
		await launch_under_earlier_run()
		write_carry(CURRENT_START, CURRENT_OWNER)

		const outcome = await transfer()

		expect(outcome.kind).toBe('written')
		await expect(lane_state.read_state(ISSUE, state.directory)).resolves.toMatchObject({
			state: 'running',
			changed_by: DISPATCH,
			launched_at: LAUNCHED_AT.toISOString(),
			adopted_at: ADOPTED_AT.toISOString(),
			run: CURRENT_RUN,
		})
	})

	it('skips a lane with no record', async () => {
		write_carry(CURRENT_START, CURRENT_OWNER)

		expect(await transfer()).toStrictEqual(NOTHING_TO_TRANSFER)
	})

	it('skips with no current run, leaving the record as it is', async () => {
		await launch_under_earlier_run()
		stamp_file.remove_stamp(run_carry.carry_path(state.directory))

		expect(await transfer()).toStrictEqual(NOTHING_TO_TRANSFER)
		await expect(lane_state.read_state(ISSUE, state.directory)).resolves.not.toHaveProperty(
			'adopted_at',
		)
	})

	it('answers a write that threw as skipped, not as an error', async () => {
		vi.spyOn(repository_lock, 'with_lock_sync').mockImplementation(() => {
			throw new Error('ENOSPC')
		})

		expect(await transfer()).toStrictEqual({ kind: 'skipped', reason: 'ENOSPC' })
	})
})

describe('lane_state.record_owner hand-over of a paused lane', () => {
	it('keeps a person’s pause and its origin (ac-b197b8b2)', async () => {
		await launch_under_earlier_run()
		await pause_by_person()
		write_carry(CURRENT_START, CURRENT_OWNER)

		await expect(transfer()).resolves.toMatchObject({ kind: 'written' })

		const record = await lane_state.read_state(ISSUE, state.directory)

		expect(record).toMatchObject({
			state: 'paused',
			paused_by: 'person',
			changed_by: PAUSE,
			run: CURRENT_RUN,
		})
		expect(lane_state.paused_note(record)).toContain(PAUSE)
	})
})

describe('lane_state.record_owner adopt', () => {
	it('gives a lane with no record an open one, owned by no hand-over', async () => {
		const outcome = await transfer('adopt')

		expect(outcome).toMatchObject({ kind: 'written', record: { state: 'open' } })
		expect(outcome).not.toHaveProperty('record.adopted_at')
	})

	it('leaves a person’s pause and its origin as they are (ac-b197b8b2)', async () => {
		await launch_under_earlier_run()
		await pause_by_person()
		write_carry(CURRENT_START, CURRENT_OWNER)

		expect(await transfer('adopt')).toMatchObject({ kind: 'rejected' })
		await expect(lane_state.read_state(ISSUE, state.directory)).resolves.toMatchObject({
			state: 'paused',
			paused_by: 'person',
		})
	})
})

describe('lane_state.record_change after a transfer', () => {
	it('drops the hand-over when the adopting run relaunches the lane', async () => {
		await launch_under_earlier_run()
		write_carry(CURRENT_START, CURRENT_OWNER)
		await transfer()
		await lane_state.record_change(
			{ issue: ISSUE, state: 'running', command: 'lane:restart', is_launch: true },
			{ directory: state.directory, now: ADOPTED_AT },
		)

		await expect(lane_state.read_state(ISSUE, state.directory)).resolves.not.toHaveProperty(
			'adopted_at',
		)
	})
})
