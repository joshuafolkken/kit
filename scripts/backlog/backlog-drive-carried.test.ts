import { josh_command } from '#scripts/josh/josh-run'
import { process_identity } from '#scripts/josh/process-identity'
import type { LaneInfo } from '#scripts/lane/lane-registry'
import { lane_state, type LaneStateRecord } from '#scripts/lane/lane-state'
import { run_carry } from '#scripts/run/carry/run-carry'
import { run_carry_ended } from '#scripts/run/carry/run-carry-ended'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const IN_PROGRESS = ['in-progress']
const CLAIMED = '3867'
const PARKED = '3865'
const IN_REVIEW = '3869'
const UNDISPATCHED = '3871'
const DIRECTORY = '/repository/.git'
const STARTED_AT = '2026-11-21T04:00:00.000Z'
const OWNER = 12_844
const SEATS = 9
const RESUMED = 'lane resumed'
const RESUME_COMMAND = 'lane:resume'
const NO_CHILD = 'no child process running'

const read_state = vi.spyOn(lane_state, 'read_state')
const directory = vi.spyOn(run_carry, 'repository_directory')
const has_ended = vi.spyOn(run_carry_ended, 'has_ended')
const is_same_process = vi.spyOn(process_identity, 'is_same_process')
const josh_run = vi.spyOn(josh_command, 'josh_run')

const STATES = new Map([
	[CLAIMED, { labels: IN_PROGRESS, is_human_review: false }],
	[PARKED, { labels: ['needs-decision'], is_human_review: false }],
	[IN_REVIEW, { labels: IN_PROGRESS, is_human_review: true }],
	[UNDISPATCHED, { labels: IN_PROGRESS, is_human_review: false }],
])

vi.mock('#scripts/issue/issue-state-cli', () => ({
	issue_state_cli: {
		read_issue: vi.fn(async (issue: string) => ({
			kind: 'state',
			state: { state: 'OPEN', labels: IN_PROGRESS, ...STATES.get(issue) },
		})),
	},
}))

const { backlog_drive_carried } = await import('./backlog-drive-carried')

beforeEach(() => {
	read_state.mockResolvedValue(undefined)
	directory.mockResolvedValue(DIRECTORY)
	has_ended.mockReturnValue(false)
	is_same_process.mockReturnValue(undefined)
	josh_run.mockResolvedValue({ code: 0, out: RESUMED })
	vi.spyOn(console, 'error').mockImplementation(vi.fn())
})

function paused(issue: string = CLAIMED): LaneStateRecord {
	return {
		issue,
		state: 'paused',
		changed_at: STARTED_AT,
		changed_by: 'lane:pause',
		run: { started_at: STARTED_AT, owner_pid: OWNER },
	}
}

function lane(issue: string, output: string | undefined): LaneInfo {
	return {
		issue,
		branch: `${issue}-lane`,
		directory: `/lanes/${issue}`,
		seat: undefined,
		development_port: undefined,
		preview_port: undefined,
		output,
		is_stranded: false,
	}
}

it('carries only dispatched lanes that still claim their issue outside a review stop', async () => {
	const lanes = [
		lane(CLAIMED, '/t/a.log'),
		lane(PARKED, '/t/b.log'),
		lane(IN_REVIEW, '/t/c.log'),
		lane(UNDISPATCHED, undefined),
	]

	expect(await backlog_drive_carried.carried(lanes)).toStrictEqual([CLAIMED])
})

describe('carrying paused lanes', () => {
	it.each([
		{ name: 'an ended run with a live owner', ended: true, live: true, resumes: true },
		{ name: 'a dead owner', ended: false, live: false, resumes: true },
		{ name: 'a live owner', ended: false, live: true, resumes: false },
		{ name: 'an unknown owner identity', ended: false, live: undefined, resumes: false },
	])('handles $name (ac-91b8d2c5, ac-30948645)', async ({ ended, live, resumes }) => {
		read_state.mockResolvedValue(paused())
		has_ended.mockReturnValue(ended)
		is_same_process.mockReturnValue(live)

		expect(await backlog_drive_carried.carried([lane(CLAIMED, '/t/a.log')])).toStrictEqual([
			CLAIMED,
		])
		expect(josh_run.mock.calls).toStrictEqual(resumes ? [[[RESUME_COMMAND, CLAIMED], true]] : [])
	})

	it('resumes all nine seats carried from a stopped run (ac-d42bf2fd)', async () => {
		const lanes = Array.from({ length: SEATS }, (_value, index) => ({
			...lane(String(index + 1), `/t/${String(index + 1)}.log`),
			seat: index + 1,
			seat_held: true,
		}))

		read_state.mockImplementation(async (issue) => paused(issue))
		has_ended.mockReturnValue(true)

		expect(await backlog_drive_carried.carried(lanes)).toStrictEqual(
			lanes.map((item) => item.issue),
		)
		expect(josh_run.mock.calls).toStrictEqual(
			lanes.map((item) => [[RESUME_COMMAND, item.issue], true]),
		)
	})
})

describe('preserving other lanes', () => {
	it('leaves a pause with no owning run alone', async () => {
		read_state.mockResolvedValue({ ...paused(), run: undefined })
		has_ended.mockReturnValue(true)

		await backlog_drive_carried.carried([lane(CLAIMED, '/t/a.log')])

		expect(josh_run).not.toHaveBeenCalled()
	})

	it('does not resume running lanes or unclaimed paused lanes', async () => {
		read_state.mockResolvedValue({ ...paused(), state: 'running' })
		has_ended.mockReturnValue(true)

		await backlog_drive_carried.carried([lane(CLAIMED, '/t/a.log'), lane(PARKED, '/t/b.log')])

		expect(josh_run).not.toHaveBeenCalled()
		expect(read_state).not.toHaveBeenCalledWith(PARKED, DIRECTORY)
	})
})

describe('resume failures and reports', () => {
	it('reports a failed resume instead of carrying a lane as resumed', async () => {
		read_state.mockResolvedValue(paused())
		has_ended.mockReturnValue(true)
		josh_run.mockResolvedValue({ code: 1, out: NO_CHILD })

		await expect(backlog_drive_carried.carried([lane(CLAIMED, '/t/a.log')])).rejects.toThrow(
			NO_CHILD,
		)
	})

	it('relays the resume report on stderr, preserving the driver stdout', async () => {
		read_state.mockResolvedValue(paused())
		has_ended.mockReturnValue(true)

		await backlog_drive_carried.carried([lane(CLAIMED, '/t/a.log')])

		expect(console.error).toHaveBeenCalledWith(RESUMED)
	})
})

describe('unknown ownership', () => {
	it.each([false, true])('requires an ended record without an owner pid: %s', async (ended) => {
		read_state.mockResolvedValue({ ...paused(), run: { started_at: STARTED_AT } })
		has_ended.mockReturnValue(ended)

		await backlog_drive_carried.carried([lane(CLAIMED, '/t/a.log')])

		expect(josh_run.mock.calls).toHaveLength(ended ? 1 : 0)
		expect(is_same_process).not.toHaveBeenCalled()
	})

	it('leaves lanes alone outside a repository', async () => {
		directory.mockResolvedValue(undefined)

		expect(await backlog_drive_carried.carried([lane(CLAIMED, '/t/a.log')])).toStrictEqual([
			CLAIMED,
		])
		expect(read_state).not.toHaveBeenCalled()
		expect(josh_run).not.toHaveBeenCalled()
	})
})
