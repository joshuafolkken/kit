import { lane_registry, type LaneInfo } from '#scripts/lane/lane-registry'
import { run_carry, type CarryRead } from '#scripts/run/carry/run-carry'
import { run_carry_ended, type EndedRun } from '#scripts/run/carry/run-carry-ended'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_read } from './run-board-read'

// joshuafolkken/kit#3439: the board reads the running run, else the one that last ended, and keeps the
// next run's events off an ended run's board.

const REPOSITORY = '/repo/.git'
const STARTED_AT = '2026-10-08T09:00:00.000Z'
const ENDED_AT = '2026-10-08T10:00:00.000Z'
const NONE: CarryRead = { kind: 'none' }
const EPIC_RUN = 'backlogrun #3431 --only'
const INSIDE: RunEvent = {
	pos: 1,
	at: '2026-10-08T09:30:00.000Z',
	kind: 'merge',
	text: '#1 merged',
}
const AFTER: RunEvent = { pos: 2, at: '2026-10-08T10:30:00.000Z', kind: 'merge', text: '#2 merged' }

function lane(issue: string): LaneInfo {
	return {
		issue,
		branch: `${issue}-lane`,
		directory: `/lanes/${issue}`,
		seat: undefined,
		development_port: undefined,
		preview_port: undefined,
		output: undefined,
		is_stranded: false,
	}
}

function arrange(read: CarryRead, ended: EndedRun | undefined): void {
	vi.spyOn(run_carry, 'repository_directory').mockResolvedValue(REPOSITORY)
	vi.spyOn(run_carry, 'read_carry').mockReturnValue(read)
	vi.spyOn(run_carry_ended, 'read_ended').mockReturnValue(ended)
	vi.spyOn(run_event_stream, 'read_events').mockReturnValue([INSIDE, AFTER])
	vi.spyOn(lane_registry, 'list_lanes').mockResolvedValue([lane('3432')])
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe('run_board_read.read_local', () => {
	it('reads the ended run with its end, its scope and only the events inside it', async () => {
		arrange(NONE, { invocation: EPIC_RUN, started_at: STARTED_AT, ended_at: ENDED_AT })

		await expect(run_board_read.read_local()).resolves.toStrictEqual({
			started_ms: Date.parse(STARTED_AT),
			ended_ms: Date.parse(ENDED_AT),
			scope: { issues: [3431], only: true },
			events: [INSIDE],
			lanes: ['3432'],
			resume: undefined,
		})
	})

	it('reads nothing when no run has started or ended here', async () => {
		arrange(NONE, undefined)

		await expect(run_board_read.read_local()).resolves.toBeUndefined()
	})

	it('reads nothing outside a git checkout', async () => {
		arrange(NONE, undefined)
		vi.spyOn(run_carry, 'repository_directory').mockResolvedValue(undefined)

		await expect(run_board_read.read_local()).resolves.toBeUndefined()
	})
})

// joshuafolkken/kit#3437: a stopped run offers its session; a run that begins hides it.
describe('run_board_read.read_local resume', () => {
	it('reads the session a stopped run resumes from, only while that run is the one drawn', async () => {
		const stopped = {
			invocation: EPIC_RUN,
			started_at: STARTED_AT,
			ended_at: ENDED_AT,
			stopped: 'decision',
			session: 'abc',
		}
		const running: CarryRead = {
			kind: 'carried',
			carry: {
				invocation: 'backlogrun',
				started_at: ENDED_AT,
				merged: 0,
				filed: 0,
				cuts: 0,
				failures: 0,
				outages: 0,
			},
		}

		arrange(NONE, stopped)
		await expect(run_board_read.read_local()).resolves.toMatchObject({ resume: 'abc' })
		vi.mocked(run_carry.read_carry).mockReturnValue(running)
		await expect(run_board_read.read_local()).resolves.toMatchObject({ resume: undefined })
	})
})
