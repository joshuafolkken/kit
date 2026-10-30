import { backlog_drive, type DriveState } from '#scripts/backlog/backlog-drive'
import { backlog_drive_epic } from '#scripts/backlog/backlog-drive-epic'
import { backlog_drive_fixture } from '#scripts/backlog/backlog-drive-fixture'
import { backlog_ready } from '#scripts/backlog/backlog-ready'
import { josh_command } from '#scripts/josh/josh-run'
import { lane_limit_cli } from '#scripts/lane/lane-limit-cli'
import { lane_limit_override } from '#scripts/lane/lane-limit-override'
import { lane_spent } from '#scripts/lane/lane-spent'
import { run_board_read } from '#scripts/run/board/run-board-read'
import { run_board_read_fixture } from '#scripts/run/board/run-board-read-fixture'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { epic_next } from './epic-next'
import { epic_stopped_fixture } from './epic-stopped-fixture'

const { REPO, EPIC, CHILD, RUNNING, STOPPED } = epic_stopped_fixture
const ARGV = [EPIC, '--repo', REPO, '--lanes']
const lines: Array<string> = []

beforeEach(() => {
	epic_stopped_fixture.arrange()
	lines.length = 0
	vi.spyOn(console, 'info').mockImplementation((line: string) => {
		lines.push(line)
	})
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => vi.restoreAllMocks())

async function command_output(argv: ReadonlyArray<string>): Promise<{ code: number; out: string }> {
	lines.length = 0
	const code = await epic_next.run(argv.slice(1))

	return { code, out: lines.join('\n') }
}

describe('epic:next --lanes with a stopped local holder', () => {
	it('offers a child at limit two with one active and one stopped labelled lane', async () => {
		expect(await epic_next.run(ARGV)).toBe(0)
		expect(lines).toEqual([CHILD])
	})

	it('agrees with lane:limit and the board capacity snapshot', async () => {
		vi.spyOn(lane_limit_override, 'read_override').mockResolvedValue(undefined)
		const room = await backlog_ready.lane_room()

		expect(await backlog_ready.count_in(room)).toEqual({
			limit: epic_stopped_fixture.LIMIT,
			free: 1,
		})
		expect(room.occupied.map((lane) => lane.issue)).toEqual([RUNNING])
		expect(room.idle).toEqual([STOPPED])
		expect(await lane_limit_cli.run([])).toBe(0)
		expect(lines.join('\n')).toContain('in use 1 · free 1')
		lines.length = 0
		await epic_next.run(ARGV)
		expect(lines).toEqual([CHILD])
	})
})

describe('board capacity with a stopped labelled lane', () => {
	it('gives the board the same occupied and free counts', async () => {
		run_board_read_fixture.arrange(
			{ kind: 'none' },
			{
				invocation: 'backlogrun #858 --only',
				started_at: '2026-10-20T01:00:00.000Z',
				ended_at: '2026-10-20T02:00:00.000Z',
			},
		)
		vi.mocked(lane_spent.idle_lanes).mockRestore()
		epic_stopped_fixture.arrange()

		expect(await run_board_read.read_local()).toMatchObject({
			occupied_count: 1,
			free_lanes: 1,
			lane_limit: epic_stopped_fixture.LIMIT,
		})
		await epic_next.run(ARGV)
		expect(lines).toEqual([CHILD])
	})
})

describe('backlog:drive with the real epic command and local capacity', () => {
	it('launches the additional epic child through a drive pass', async () => {
		vi.spyOn(josh_command, 'josh_run').mockImplementation(command_output)
		const { ports, calls } = backlog_drive_fixture.harness({})
		const epic_ports = {
			...ports,
			free_lanes: backlog_ready.drive_free_lane_count,
			limit_room: backlog_ready.drive_limit_room,
			offer: async (state: DriveState) =>
				await backlog_drive_epic.offer(EPIC, state, String(process.pid)),
		}

		await backlog_drive.run_pass(backlog_drive_fixture.state([RUNNING]), true, epic_ports)

		expect(josh_command.josh_run).toHaveBeenCalledWith(['epic:next', ...ARGV], true)
		expect(calls).toContain(`launch ${CHILD}`)
	})
})
