import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { lane_ledger } from './lane-ledger'
import { lane_pause } from './lane-pause'
import { lane_pause_cli } from './lane-pause-cli'
import { lane_registry } from './lane-registry'
import { lane_state } from './lane-state'

// joshuafolkken/kit#4198: `josh lane:pause` / `lane:resume` take one issue or `--all`, and a named lane
// with nothing to signal exits non-zero.

const ISSUE = '4198'
const OTHER = '4197'
const LANE = { issue: ISSUE, directory: '/w/.kit-lanes/4198' }
const OTHER_LANE = { issue: OTHER, directory: '/w/.kit-lanes/4197' }
const SUCCESS = 0
const FAILURE = 1
const TREE = { signalled: [101, 102], child: [101, 102], is_unread: false }
const NOTHING = { signalled: [], child: [], is_unread: false }
const RESIDENT_ONLY = { signalled: [103], child: [], is_unread: false }
const UNREAD = { ...TREE, is_unread: true }
const USAGE = [
	'Usage: josh lane:pause <issue-number> | josh lane:pause --all',
	'       josh lane:resume <issue-number> | josh lane:resume --all',
].join('\n')

const pause_lane = vi.spyOn(lane_pause, 'pause_lane')
const resume_lane = vi.spyOn(lane_pause, 'resume_lane')
const open_lanes = vi.spyOn(lane_pause, 'open_lanes')
const lane_of = vi.spyOn(lane_registry, 'lane_location')
const error = vi.spyOn(console, 'error')
const info = vi.spyOn(console, 'info')
const record_change = vi.spyOn(lane_state, 'record_change')
const emit = vi.spyOn(run_event_stream_emit, 'emit')
const record_lane_state = vi.spyOn(lane_ledger, 'record_lane_state')

beforeEach(() => {
	vi.clearAllMocks()
	error.mockImplementation(vi.fn())
	info.mockImplementation(vi.fn())
	record_change.mockResolvedValue({ kind: 'skipped', reason: 'test' })
	emit.mockResolvedValue(undefined)
	record_lane_state.mockResolvedValue(undefined)
	pause_lane.mockReturnValue(TREE)
	resume_lane.mockReturnValue(TREE)
	lane_of.mockResolvedValue(LANE)
})

describe('lane_pause_cli.run — one lane', () => {
	it('pauses the named lane and reports how many processes it stopped', async () => {
		expect(await lane_pause_cli.run(['pause', ISSUE])).toBe(SUCCESS)
		expect(lane_of).toHaveBeenCalledWith(ISSUE)
		expect(pause_lane).toHaveBeenCalledWith(LANE)
		expect(info).toHaveBeenCalledWith('lane:pause #4198: paused 2 process(es)')
	})

	it('resumes the named lane', async () => {
		expect(await lane_pause_cli.run(['resume', ISSUE])).toBe(SUCCESS)
		expect(resume_lane).toHaveBeenCalledWith(LANE)
		expect(pause_lane).not.toHaveBeenCalled()
	})

	it('exits non-zero when the named lane has no child process to signal', async () => {
		pause_lane.mockReturnValue(NOTHING)

		expect(await lane_pause_cli.run(['pause', ISSUE])).toBe(FAILURE)
		expect(info).toHaveBeenCalledWith('lane:pause #4198: no child process running — nothing paused')
	})

	// joshuafolkken/kit#4300: a detached resident (`eslint_d`) outlives the child, so signalling it alone
	// pauses no lane.
	it('exits non-zero and records nothing when only a detached resident was signalled', async () => {
		pause_lane.mockReturnValue(RESIDENT_ONLY)

		expect(await lane_pause_cli.run(['pause', ISSUE])).toBe(FAILURE)
		expect(info).toHaveBeenCalledWith(
			'lane:pause #4198: no child process running — paused 1 detached process(es), state unchanged',
		)
		expect(record_change).not.toHaveBeenCalled()
		expect(emit).not.toHaveBeenCalled()
	})

	// joshuafolkken/kit#4300: a resume whose resident read failed may leave a resident stopped.
	it('exits non-zero and says so when the detached processes could not be read', async () => {
		resume_lane.mockReturnValue(UNREAD)

		expect(await lane_pause_cli.run(['resume', ISSUE])).toBe(FAILURE)
		expect(info).toHaveBeenCalledWith(
			'lane:resume #4198: resumed 2 process(es) — could not read the detached processes (lsof or ps failed); any of them was missed',
		)
		expect(record_change).toHaveBeenCalledOnce()
	})
})

// joshuafolkken/kit#5168: the ledger keeps every change, so `lane:stats` reads the paused spans.
describe('lane_pause_cli.run — the ledger', () => {
	it('appends each pause and resume to the lane ledger', async () => {
		await lane_pause_cli.run(['pause', ISSUE])
		await lane_pause_cli.run(['resume', ISSUE])

		expect(record_lane_state.mock.calls).toStrictEqual([
			[{ issue: Number(ISSUE), state: 'paused' }],
			[{ issue: Number(ISSUE), state: 'running' }],
		])
	})
})

// joshuafolkken/kit#4268: a lane whose processes were signalled has the change on its state record and
// on the run's event stream.
describe('lane_pause_cli.run — the record', () => {
	it('records a paused lane and emits who paused it', async () => {
		await lane_pause_cli.run(['pause', ISSUE])

		expect(record_change).toHaveBeenCalledExactlyOnceWith({
			issue: ISSUE,
			state: 'paused',
			command: 'lane:pause',
		})
		expect(emit).toHaveBeenCalledExactlyOnceWith(
			run_event_stream.EVENT_KIND.LANE_STATE,
			'#4198 paused by lane:pause',
		)
	})

	it('records a resumed lane as running', async () => {
		await lane_pause_cli.run(['resume', ISSUE])

		expect(record_change).toHaveBeenCalledWith({
			issue: ISSUE,
			state: 'running',
			command: 'lane:resume',
		})
	})

	it('records nothing when no process was signalled', async () => {
		pause_lane.mockReturnValue(NOTHING)
		await lane_pause_cli.run(['pause', ISSUE])

		expect(record_change).not.toHaveBeenCalled()
		expect(record_lane_state).not.toHaveBeenCalled()
		expect(emit).not.toHaveBeenCalled()
	})
})

describe('lane_pause_cli.run — --all', () => {
	it('signals every open lane, and an idle one is not a failure', async () => {
		open_lanes.mockResolvedValue([OTHER_LANE, LANE])
		pause_lane.mockReturnValueOnce(NOTHING)

		expect(await lane_pause_cli.run(['pause', '--all'])).toBe(SUCCESS)
		expect(pause_lane.mock.calls).toStrictEqual([[OTHER_LANE], [LANE]])
	})

	it('fails when any lane’s detached processes could not be read', async () => {
		open_lanes.mockResolvedValue([OTHER_LANE, LANE])
		resume_lane.mockReturnValueOnce(UNREAD)

		expect(await lane_pause_cli.run(['resume', '--all'])).toBe(FAILURE)
	})
})

describe('lane_pause_cli.run — the usage', () => {
	it.each([
		['no target', ['pause']],
		['two issues', ['pause', ISSUE, OTHER]],
		['a non-number issue', ['pause', '#4198']],
		['an unknown verb', ['stop', ISSUE]],
	])('refuses %s with the usage line, signalling nothing', async (_label, argv) => {
		expect(await lane_pause_cli.run(argv)).toBe(FAILURE)
		expect(error).toHaveBeenCalledWith(USAGE)
		expect(pause_lane).not.toHaveBeenCalled()
	})
})
