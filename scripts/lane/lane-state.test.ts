import { spawn } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { repository_lock } from '#scripts/git/repository-lock'
import { PLATFORM_TEMP_ROOT } from '#scripts/josh/platform-temporary'
import { stamp_file } from '#scripts/josh/stamp-file'
import { figure_format } from '#scripts/lib/figure-format'
import { run_carry } from '#scripts/run/carry/run-carry'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { lane_state, type LaneChange } from './lane-state'

const ISSUE = '4268'
const OTHER_ISSUE = '4300'
const STUCK = [{ pid: 20_611, reason: 'owned by root' }]
const OPENED_AT = new Date('2026-10-20T01:00:00.000Z')
const LAUNCHED_AT = new Date('2026-10-20T02:00:00.000Z')
const PAUSED_AT = new Date('2026-10-20T03:00:00.000Z')
const CARRY_STARTED_AT = new Date('2026-10-20T00:30:00.000Z')
const OWNER_PID = 4242
const WRITES_PER_WRITER = 40
const SPAWN_TIMEOUT_MS = 30_000
const OPEN = 'lane:open'
const DISPATCH = 'lane:dispatch'
const PAUSE = 'lane:pause'
const CLOSE = 'lane:close'
const HUMAN_REVIEW = 'human-review'

const state = { directory: '' }

function change_of(
	to: LaneChange['state'],
	command: string,
	extra: Partial<LaneChange> = {},
): LaneChange {
	return { issue: ISSUE, state: to, command, ...extra }
}

async function record_at(change: LaneChange, now: Date): Promise<void> {
	await lane_state.record_change(change, { directory: state.directory, now })
}

beforeEach(() => {
	state.directory = mkdtempSync(path.join(tmpdir(), 'lane-state-'))
	vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
	stamp_file.remove_stamp(run_carry.carry_path(state.directory))
	stamp_file.remove_stamp(lane_state.state_path(state.directory, ISSUE))
	stamp_file.remove_stamp(lane_state.state_path(state.directory, OTHER_ISSUE))
	rmSync(state.directory, { recursive: true, force: true })
	vi.restoreAllMocks()
})

describe('lane_state.record_change — each command leaves the record it names', () => {
	it('records an opened lane with the time and the command that opened it', async () => {
		await record_at(change_of('open', OPEN), OPENED_AT)

		expect(await lane_state.read_state(ISSUE, state.directory)).toStrictEqual({
			issue: ISSUE,
			state: 'open',
			changed_at: OPENED_AT.toISOString(),
			changed_by: OPEN,
		})
	})

	it('stamps a launch with its time and the run that launched it', async () => {
		const carry = run_carry.fresh_carry('backlogrun', { pid: OWNER_PID }, CARRY_STARTED_AT)

		stamp_file.replace_stamp(run_carry.carry_path(state.directory), carry)
		await record_at(change_of('running', DISPATCH, { is_launch: true }), LAUNCHED_AT)

		expect(await lane_state.read_state(ISSUE, state.directory)).toMatchObject({
			state: 'running',
			launched_at: LAUNCHED_AT.toISOString(),
			run: { started_at: CARRY_STARTED_AT.toISOString(), owner_pid: OWNER_PID },
		})
	})
})

describe('lane_state.record_change — a launch outlives the changes after it', () => {
	it('keeps the launch through a pause and moves only the state and its change', async () => {
		await record_at(change_of('running', DISPATCH, { is_launch: true }), LAUNCHED_AT)
		await record_at(change_of('paused', PAUSE), PAUSED_AT)

		expect(await lane_state.read_state(ISSUE, state.directory)).toStrictEqual({
			issue: ISSUE,
			state: 'paused',
			launched_at: LAUNCHED_AT.toISOString(),
			changed_at: PAUSED_AT.toISOString(),
			changed_by: PAUSE,
		})
	})

	it('starts a reopened lane afresh, keeping nothing of its last launch', async () => {
		await record_at(change_of('running', DISPATCH, { is_launch: true }), LAUNCHED_AT)
		await record_at(change_of('ended', CLOSE), PAUSED_AT)
		await record_at(change_of('open', OPEN), OPENED_AT)

		expect(await lane_state.read_state(ISSUE, state.directory)).not.toHaveProperty('launched_at')
	})
})

// joshuafolkken/kit#4270: the readers that count lanes and name a paused holder.
describe('lane_state.read_states and paused_note', () => {
	it('reads each issue’s record by issue, leaving out an issue with none', async () => {
		await record_at(change_of('paused', PAUSE), PAUSED_AT)

		const records = await lane_state.read_states([ISSUE, '9999'], state.directory)

		expect([...records.keys()]).toStrictEqual([ISSUE])
		expect(records.get(ISSUE)?.state).toBe('paused')
	})

	it('names when a paused lane was paused and the command that paused it', async () => {
		await record_at(change_of('paused', PAUSE), PAUSED_AT)

		const record = await lane_state.read_state(ISSUE, state.directory)
		const since = figure_format.minute_of(PAUSED_AT.getTime())

		expect(lane_state.paused_note(record)).toBe(`paused since ${since} by ${PAUSE}`)
	})

	it('notes nothing for a lane that is not paused or has no record', async () => {
		await record_at(change_of('running', DISPATCH), LAUNCHED_AT)

		expect(
			lane_state.paused_note(await lane_state.read_state(ISSUE, state.directory)),
		).toBeUndefined()
		expect(lane_state.paused_note(undefined)).toBeUndefined()
	})
})

describe('lane_state.record_change — transitions', () => {
	it('keeps a human-review lane until a fresh dispatch resumes it', async () => {
		await record_at(change_of('running', DISPATCH, { is_launch: true }), LAUNCHED_AT)
		await record_at(change_of(HUMAN_REVIEW, 'run:hold --human-review-stop'), PAUSED_AT)
		expect(await lane_state.read_state(ISSUE, state.directory)).toMatchObject({
			state: HUMAN_REVIEW,
			launched_at: LAUNCHED_AT.toISOString(),
		})
		await record_at(change_of('running', DISPATCH, { is_launch: true }), PAUSED_AT)
		expect(await lane_state.read_state(ISSUE, state.directory)).toMatchObject({ state: 'running' })
	})

	it('writes no transition the lifecycle lacks, and warns instead', async () => {
		await record_at(change_of('ended', CLOSE), OPENED_AT)
		const outcome = await lane_state.record_change(change_of('paused', PAUSE), {
			directory: state.directory,
		})

		expect(outcome.kind).toBe('skipped')
		expect(await lane_state.read_state(ISSUE, state.directory)).toMatchObject({ state: 'ended' })
		expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('lane state not recorded'))
	})

	it('takes any state for a lane with no record yet', () => {
		for (const to of lane_state.LANE_STATES) expect(lane_state.is_allowed(undefined, to)).toBe(true)
	})

	it('overwrites a record it cannot parse rather than failing the command', async () => {
		const target = lane_state.state_path(state.directory, ISSUE)

		await record_at(change_of('open', OPEN), OPENED_AT)
		writeFileSync(target, '{ not json')
		await record_at(change_of('paused', PAUSE), PAUSED_AT)

		expect(await lane_state.read_state(ISSUE, state.directory)).toMatchObject({ state: 'paused' })
	})
})

describe('lane_state.record_change — the record’s lock', () => {
	it('reads and writes under the lock beside the record', async () => {
		const locked = vi.spyOn(repository_lock, 'with_lock_sync')

		await record_at(change_of('open', OPEN), OPENED_AT)

		expect(locked).toHaveBeenCalledWith(
			expect.any(Function),
			`${lane_state.state_path(state.directory, ISSUE)}.lock`,
			expect.any(Number),
		)
	})

	it('writes nothing while another writer holds the lock', async () => {
		vi.spyOn(repository_lock, 'with_lock_sync').mockReturnValue(undefined)

		await record_at(change_of('open', OPEN), OPENED_AT)

		expect(await lane_state.read_state(ISSUE, state.directory)).toBeUndefined()
		expect(console.warn).toHaveBeenCalledWith(
			expect.stringContaining('gave up waiting for the lock'),
		)
	})
})

const WRITER = path.resolve('scripts/lane/lane-state.ts')

function writer_script(to: string): string {
	return [
		`const { lane_state } = await import(${JSON.stringify(WRITER)})`,
		`for (let index = 0; index < ${String(WRITES_PER_WRITER)}; index += 1) {`,
		`  await lane_state.record_change({ issue: '${ISSUE}', state: '${to}', command: 'lane:${to}' },`,
		`    { directory: ${JSON.stringify(state.directory)} })`,
		'}',
	].join('\n')
}

async function run_writer(to: string): Promise<number | null> {
	const child = spawn(
		process.execPath,
		['--import', 'tsx', '--input-type=module', '-e', writer_script(to)],
		{
			stdio: 'ignore',
		},
	)

	return await new Promise((resolve) => {
		child.on('exit', (code) => {
			resolve(code)
		})
	})
}

describe('lane_state.record_change — two writers at once', () => {
	it(
		'leaves one whole record and no temporary file when two processes write the same lane',
		async () => {
			const codes = await Promise.all([run_writer('paused'), run_writer('running')])
			const record = await lane_state.read_state(ISSUE, state.directory)
			const target = path.basename(lane_state.state_path(state.directory, ISSUE))
			const left = readdirSync(PLATFORM_TEMP_ROOT).filter((name) => name.startsWith(`${target}.`))

			expect(codes).toStrictEqual([0, 0])
			expect(['paused', 'running']).toContain(record?.state)
			expect(left).toStrictEqual([])
		},
		SPAWN_TIMEOUT_MS,
	)
})

// joshuafolkken/kit#4300: the supervisor finds a close a process outlived among every lane's record.
describe('lane_state.read_records', () => {
	it('lists every lane’s record, a closed lane’s included', async () => {
		await record_at(change_of('open', OPEN), OPENED_AT)
		await record_at({ issue: OTHER_ISSUE, state: 'ended', command: CLOSE }, PAUSED_AT)

		const records = await lane_state.read_records(state.directory)

		expect(records).toHaveLength(2)
		expect(records).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ issue: ISSUE, state: 'open' }),
				expect.objectContaining({ issue: OTHER_ISSUE, state: 'ended' }),
			]),
		)
	})
})

describe('lane_state.record_stuck', () => {
	it('notes the processes on the record and keeps its state', async () => {
		await record_at(change_of('open', OPEN), OPENED_AT)

		await lane_state.record_stuck(ISSUE, STUCK, state.directory)

		await expect(lane_state.read_state(ISSUE, state.directory)).resolves.toMatchObject({
			state: 'open',
			stuck: STUCK,
		})
	})

	it('gives a lane with no record none', async () => {
		const outcome = await lane_state.record_stuck(ISSUE, STUCK, state.directory)

		expect(outcome).toStrictEqual({ kind: 'skipped', reason: 'no record' })
		await expect(lane_state.read_state(ISSUE, state.directory)).resolves.toBeUndefined()
	})
})

// joshuafolkken/kit#4744: `lane:adopt` writes a lane a record only while it has none.
describe('lane_state.record_adopted', () => {
	const ADOPT = 'lane:adopt'

	it('writes the change for a lane with no record', async () => {
		const outcome = await lane_state.record_adopted(change_of('open', ADOPT), {
			directory: state.directory,
			now: OPENED_AT,
		})

		expect(outcome.kind).toBe('written')
		await expect(lane_state.read_state(ISSUE, state.directory)).resolves.toMatchObject({
			state: 'open',
			changed_by: ADOPT,
		})
	})

	it('leaves a lane that has a record as it is', async () => {
		await record_at(change_of('ended', CLOSE), PAUSED_AT)

		const outcome = await lane_state.record_adopted(change_of('open', ADOPT), {
			directory: state.directory,
		})

		expect(outcome).toStrictEqual({ kind: 'skipped', reason: 'a record exists' })
		await expect(lane_state.read_state(ISSUE, state.directory)).resolves.toMatchObject({
			state: 'ended',
			changed_by: CLOSE,
		})
	})

	it('answers a write that threw as skipped, not as an error', async () => {
		vi.spyOn(repository_lock, 'with_lock_sync').mockImplementation(() => {
			throw new Error('ENOSPC')
		})

		const outcome = await lane_state.record_adopted(change_of('open', ADOPT), {
			directory: state.directory,
		})

		expect(outcome).toStrictEqual({ kind: 'skipped', reason: 'ENOSPC' })
	})
})
