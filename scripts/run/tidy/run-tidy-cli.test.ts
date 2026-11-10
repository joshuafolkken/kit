import { issue_merged } from '#scripts/issue/issue-merged'
import { lane_ledger_archive } from '#scripts/lane/lane-ledger-archive'
import { lane_ledger_write } from '#scripts/lane/lane-ledger-write'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { run_ship_lap } from '#scripts/run/ship/run-ship-lap'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { run_tidy_cli } from './run-tidy-cli'
import { run_tidy_lanes } from './run-tidy-lanes'
import { run_tidy_stashes } from './run-tidy-stashes'

vi.mock('#scripts/issue/issue-merged', () => ({ issue_merged: { read_merged: vi.fn() } }))
vi.mock('#scripts/run/event/run-event-stream-emit', () => ({
	run_event_stream_emit: { current_events: vi.fn() },
}))
vi.mock('./run-tidy-lanes', () => ({ run_tidy_lanes: { tidy_lanes: vi.fn() } }))
vi.mock('./run-tidy-stashes', () => ({ run_tidy_stashes: { tidy_stashes: vi.fn() } }))
vi.mock('#scripts/lane/lane-ledger-archive', () => ({
	lane_ledger_archive: { rotate_target: vi.fn() },
}))
vi.mock('#scripts/lane/lane-ledger-write', () => ({
	lane_ledger_write: { record_ship_lap: vi.fn() },
}))

const errors: Array<string> = []
const LANE_TARGET = 'lane #2583'
const STASH_TARGET = 'stash "On main: parked #2584"'
const AT = '2026-10-08T08:00:00.000Z'
const KIND = run_event_stream.EVENT_KIND

beforeEach(() => {
	errors.length = 0
	vi.spyOn(console, 'error').mockImplementation((...parts: Array<unknown>) => {
		errors.push(parts.map(String).join(' '))
	})
	vi.mocked(issue_merged.read_merged).mockResolvedValue(true)
	vi.mocked(run_event_stream_emit.current_events).mockResolvedValue([])
	vi.mocked(run_tidy_lanes.tidy_lanes).mockResolvedValue([])
	vi.mocked(run_tidy_stashes.tidy_stashes).mockResolvedValue([])
	vi.mocked(lane_ledger_archive.rotate_target).mockResolvedValue(0)
})

describe('run_tidy_cli.sweep timing', () => {
	it('records the entire sweep under its inherited hold scope', async () => {
		await run_ship_lap.within('6255', 'run:entry', run_tidy_cli.sweep, 'run:entry › run:hold')

		expect(lane_ledger_write.record_ship_lap).toHaveBeenCalledWith(
			expect.objectContaining({
				issue: 6255,
				stage: 'run:entry',
				step: 'run:entry › run:hold › sweep',
			}),
		)
	})
})

// The detached sweep reports on stderr and never throws.
describe('run_tidy_cli.sweep', () => {
	it('reports cleaned lanes and stashes together on standard error', async () => {
		vi.mocked(run_tidy_lanes.tidy_lanes).mockResolvedValue([
			{ target: LANE_TARGET, verdict: { kind: 'clean' } },
		])
		vi.mocked(run_tidy_stashes.tidy_stashes).mockResolvedValue([
			{ target: STASH_TARGET, verdict: { kind: 'clean' } },
		])

		await run_tidy_cli.sweep()

		expect(errors.join('\n')).toBe(
			['run:tidy — cleaned:', `  ${LANE_TARGET}`, `  ${STASH_TARGET}`].join('\n'),
		)
	})

	it('prints nothing when nothing merged was found', async () => {
		await run_tidy_cli.sweep()

		expect(errors).toStrictEqual([])
	})

	it('reads each issue once across both halves', async () => {
		vi.mocked(run_tidy_lanes.tidy_lanes).mockImplementation(async (is_merged) => {
			await is_merged('2583')

			return []
		})
		vi.mocked(run_tidy_stashes.tidy_stashes).mockImplementation(async (is_merged) => {
			await is_merged('2583')

			return []
		})

		await run_tidy_cli.sweep()

		expect(issue_merged.read_merged).toHaveBeenCalledOnce()
	})

	it('notes a failure instead of throwing', async () => {
		vi.mocked(run_tidy_lanes.tidy_lanes).mockRejectedValue(new Error('git missing'))

		await expect(run_tidy_cli.sweep()).resolves.toBeUndefined()
		expect(errors.join('\n')).toContain('run:tidy could not finish')
	})
})

// joshuafolkken/kit#7038: the sweep rotates the lane ledger, and a failed rotation is a note.
describe('run_tidy_cli.sweep — the lane ledger', () => {
	it('rotates the lane ledger after the residue', async () => {
		await run_tidy_cli.sweep()

		expect(lane_ledger_archive.rotate_target).toHaveBeenCalledOnce()
	})

	it('notes a failed rotation instead of throwing', async () => {
		vi.mocked(lane_ledger_archive.rotate_target).mockRejectedValue(new Error('disk full'))

		await expect(run_tidy_cli.sweep()).resolves.toBeUndefined()
		expect(errors.join('\n')).toContain('could not rotate the lane ledger')
	})
})

// joshuafolkken/kit#3451: a lane the running backlogrun still has in flight is its run:merge's.
describe('run_tidy_cli.sweep — the running backlogrun', () => {
	it('passes its in-flight issues to the lane half', async () => {
		vi.mocked(run_event_stream_emit.current_events).mockResolvedValue([
			{ pos: 1, at: AT, kind: KIND.CHILD_LAUNCH, text: '#2583 launched' },
			{ pos: 2, at: AT, kind: KIND.CHILD_LAUNCH, text: '#2584 launched' },
			{ pos: 3, at: AT, kind: KIND.MERGE, text: '#2584 merged' },
		])

		await run_tidy_cli.sweep()

		expect(run_tidy_lanes.tidy_lanes).toHaveBeenCalledWith(expect.any(Function), new Set(['2583']))
	})
})
