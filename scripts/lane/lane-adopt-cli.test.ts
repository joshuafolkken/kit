import type { IssueState } from '#scripts/issue/issue-state'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { lane_adopt } from './lane-adopt'
import { lane_adopt_cli } from './lane-adopt-cli'
import { lane_registry, type LaneInfo } from './lane-registry'
import { lane_state } from './lane-state'

// joshuafolkken/kit#4744: `josh lane:adopt` takes one issue or `--all`, and a named lane left unknown
// exits non-zero.

const ISSUE = '4744'
const OTHER = '4745'
const SUCCESS = 0
const FAILURE = 1
const USAGE = 'Usage: josh lane:adopt <issue-number> | josh lane:adopt --all'
const ISSUE_READ: IssueState = { state: 'OPEN', labels: [], is_human_review: false }
const FACTS = {
	branch: `${ISSUE}-lane`,
	is_dirty: false,
	unpushed: 0,
	pull: undefined,
	issue: ISSUE_READ,
}
const ADOPTED = { kind: 'adopted' as const, facts: FACTS }
const LEFT = { kind: 'left' as const, reason: 'a child is working in it' }

function lane(issue: string): LaneInfo {
	return {
		issue,
		branch: `${issue}-lane`,
		directory: `/lanes/${issue}`,
		seat: 1,
		development_port: undefined,
		preview_port: undefined,
		output: undefined,
		is_stranded: false,
	}
}

const find_open_lane = vi.spyOn(lane_registry, 'find_open_lane')
const list_lanes = vi.spyOn(lane_registry, 'list_lanes')
const read_states = vi.spyOn(lane_state, 'read_states')
const adopt = vi.spyOn(lane_adopt, 'adopt')
const emit = vi.spyOn(run_event_stream_emit, 'emit')
const info = vi.spyOn(console, 'info')
const error = vi.spyOn(console, 'error')

beforeEach(() => {
	vi.clearAllMocks()
	info.mockImplementation(vi.fn())
	error.mockImplementation(vi.fn())
	emit.mockResolvedValue(undefined)
	read_states.mockResolvedValue(new Map())
	find_open_lane.mockResolvedValue(lane(ISSUE))
	list_lanes.mockResolvedValue([lane(ISSUE), lane(OTHER)])
	adopt.mockResolvedValue(ADOPTED)
})

describe('lane_adopt_cli.run — one lane', () => {
	it('records the named lane and puts it on the event stream', async () => {
		expect(await lane_adopt_cli.run([ISSUE])).toBe(SUCCESS)
		expect(info).toHaveBeenCalledWith(
			expect.stringContaining(
				': recorded open — branch 4744-lane · clean tree · 0 unpushed commit(s) · no PR · issue OPEN',
			),
		)
		expect(emit).toHaveBeenCalledWith(
			run_event_stream.EVENT_KIND.NOTE,
			'#4744 adopted by lane:adopt',
		)
	})

	it('exits non-zero for a named lane left unknown, and records no event', async () => {
		adopt.mockResolvedValue(LEFT)

		expect(await lane_adopt_cli.run([ISSUE])).toBe(FAILURE)
		expect(info).toHaveBeenCalledWith(
			expect.stringContaining('left unknown — a child is working in it'),
		)
		expect(emit).not.toHaveBeenCalled()
	})

	it('exits zero for a named lane already recorded, and records no event', async () => {
		adopt.mockResolvedValue({ kind: 'kept', state: 'running' })

		expect(await lane_adopt_cli.run([ISSUE])).toBe(SUCCESS)
		expect(info).toHaveBeenCalledWith(expect.stringContaining(': already recorded running'))
		expect(emit).not.toHaveBeenCalled()
	})

	it('exits non-zero when the issue has no open lane', async () => {
		find_open_lane.mockResolvedValue(undefined)

		expect(await lane_adopt_cli.run([ISSUE])).toBe(FAILURE)
		expect(error).toHaveBeenCalledWith(expect.stringContaining('No open lane for '))
		expect(adopt).not.toHaveBeenCalled()
	})
})

describe('lane_adopt_cli.run — every lane', () => {
	it('adopts every open lane, and a lane left unknown is no failure', async () => {
		adopt.mockResolvedValueOnce(ADOPTED).mockResolvedValueOnce(LEFT)

		expect(await lane_adopt_cli.run(['--all'])).toBe(SUCCESS)
		expect(adopt).toHaveBeenCalledTimes(2)
		expect(emit).toHaveBeenCalledTimes(1)
	})
})

describe('lane_adopt_cli.run — bad arguments', () => {
	it.each([[[]], [['abc']], [[ISSUE, OTHER]]])('prints the usage for %j', async (argv) => {
		expect(await lane_adopt_cli.run(argv)).toBe(FAILURE)
		expect(error).toHaveBeenCalledWith(USAGE)
	})
})
