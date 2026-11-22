import { issue_state_cli } from '#scripts/issue/issue-state-cli'
import { josh_command } from '#scripts/josh/josh-run'
import { lane_registry, type LaneInfo } from '#scripts/lane/lane-registry'
import { lane_sampler } from '#scripts/lane/lane-sampler'
import { lane_state, type LaneStateRecord } from '#scripts/lane/lane-state'
import { run_carry, type RunCarry } from '#scripts/run/carry/run-carry'
import { run_carry_ended } from '#scripts/run/carry/run-carry-ended'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { beforeEach, expect, it, vi } from 'vitest'
import { backlog_drive } from './backlog-drive'
import { backlog_drive_cli } from './backlog-drive-cli'
import { backlog_drive_hold } from './backlog-drive-hold'
import { backlog_drive_named } from './backlog-drive-named'
import { backlog_drive_record } from './backlog-drive-record'

const NAMED = '8460'
const FOREIGN = '8440'
const STARTED_AT = '2026-11-21T04:00:00.000Z'
const DIRECTORY = '/repository/.git'
const CARRY: RunCarry = {
	invocation: `backlogrun #${NAMED} --only`,
	started_at: STARTED_AT,
	merged: 0,
	filed: 0,
	cuts: 0,
	failures: 0,
	outages: 0,
}
const states = new Map<string, LaneStateRecord>()
const resumed: Array<string> = []
const transferred: Array<string> = []

function lane(issue: string): LaneInfo {
	return {
		issue,
		branch: `${issue}-lane`,
		directory: `/lanes/${issue}`,
		seat: undefined,
		development_port: undefined,
		preview_port: undefined,
		output: `/logs/${issue}.log`,
		is_stranded: false,
	}
}

function paused(issue: string): LaneStateRecord {
	return {
		issue,
		state: 'paused',
		changed_at: STARTED_AT,
		changed_by: 'lane:pause',
		run: { started_at: STARTED_AT },
	}
}

function arrange_resumes(): void {
	vi.spyOn(run_carry, 'repository_directory').mockResolvedValue(DIRECTORY)
	vi.spyOn(run_carry_ended, 'has_ended').mockReturnValue(true)
	vi.spyOn(lane_state, 'read_state').mockImplementation(async (issue) => states.get(issue))
	vi.spyOn(lane_state, 'record_transfer').mockImplementation(async (issue) => {
		transferred.push(issue)

		return { kind: 'skipped', reason: 'isolated fixture' }
	})
	vi.spyOn(josh_command, 'josh_run').mockImplementation(async (argv) => {
		const issue = argv[1] ?? ''
		const record = states.get(issue)

		expect(argv[0]).toBe('lane:resume')
		if (record !== undefined) states.set(issue, { ...record, state: 'running' })
		resumed.push(issue)

		return { code: 0, out: `resumed ${issue}` }
	})
}

function arrange_driver(): void {
	vi.spyOn(backlog_drive_record, 'read_record').mockResolvedValue(CARRY)
	vi.spyOn(run_event_stream_emit, 'current_events').mockResolvedValue([])
	vi.spyOn(backlog_drive_named, 'reconcile').mockResolvedValue()
	vi.spyOn(lane_registry, 'list_lanes').mockResolvedValue([lane(FOREIGN), lane(NAMED)])
	vi.spyOn(issue_state_cli, 'read_issue').mockResolvedValue({
		kind: 'state',
		state: { state: 'OPEN', labels: ['in-progress'], is_human_review: false },
	})
	vi.spyOn(lane_sampler, 'start').mockReturnValue(vi.fn())
	vi.spyOn(backlog_drive_hold, 'recorder').mockReturnValue({
		hold: vi.fn(),
		answering: <T>(offer: T): T => offer,
		end: vi.fn(),
	})
	vi.spyOn(backlog_drive, 'run_loop').mockResolvedValue({
		reason: 'stop',
		token: 'stop',
		issue: undefined,
	})
}

beforeEach(() => {
	states.clear()
	resumed.length = 0
	transferred.length = 0
	for (const issue of [FOREIGN, NAMED]) states.set(issue, paused(issue))
	vi.spyOn(console, 'info').mockImplementation(vi.fn())
	vi.spyOn(console, 'error').mockImplementation(vi.fn())
	arrange_resumes()
	arrange_driver()
})

it('resumes only owned lanes after scoped carrying (ac-76017215, ac-205dc715, ac-f1e71b46)', async () => {
	expect(await backlog_drive_cli.run(['--owner', String(process.pid), '--only'])).toBe(0)
	expect(resumed).toStrictEqual([NAMED])
	expect(transferred).toStrictEqual([NAMED])
	expect(states.get(NAMED)?.state).toBe('running')
	expect(states.get(FOREIGN)?.state).toBe('paused')
	expect(backlog_drive.run_loop).toHaveBeenCalledWith(
		expect.objectContaining({ in_flight: [NAMED] }),
		expect.anything(),
		expect.anything(),
	)
})

it('resumes all carried paused lanes in an unscoped run (ac-b2a9e00b)', async () => {
	vi.mocked(backlog_drive_record.read_record).mockResolvedValue({
		...CARRY,
		invocation: 'backlogrun',
	})

	expect(await backlog_drive_cli.run(['--owner', String(process.pid)])).toBe(0)
	expect(resumed).toStrictEqual([FOREIGN, NAMED])
	expect([...states.values()].map((record) => record.state)).toStrictEqual(['running', 'running'])
})
