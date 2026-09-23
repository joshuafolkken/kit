import { beforeEach, describe, expect, it, vi } from 'vitest'

const emit_mock = vi.hoisted(() => vi.fn())
const is_child_mock = vi.hoisted(() => vi.fn())
const find_lane_mock = vi.hoisted(() => vi.fn())
const relaunch_mock = vi.hoisted(() => vi.fn())

vi.mock('./run-event-stream-emit', () => ({ run_event_stream_emit: { emit: emit_mock } }))
vi.mock('#scripts/lane/lane-child-marker', () => ({
	lane_child_marker: { is_child_of: is_child_mock },
}))
vi.mock('#scripts/lane/lane-registry', () => ({
	lane_registry: { find_open_lane: find_lane_mock },
}))
vi.mock('#scripts/lane/lane-relaunch', () => ({ lane_relaunch: { relaunch: relaunch_mock } }))

const { run_ship_return } = await import('./run-ship-return')

// joshuafolkken/kit#2428: a detached supervisor that stops has nobody reading its report, so it records
// the stop as a position and — in a dispatched Anthropic lane — relaunches a child to fix it.

const ISSUE = '2428'
const LANE = { issue: ISSUE, directory: '/lanes/2428', profile: undefined }

beforeEach(() => {
	emit_mock.mockReset()
	is_child_mock.mockReset().mockReturnValue(true)
	find_lane_mock.mockReset().mockResolvedValue(LANE)
	relaunch_mock.mockReset().mockReturnValue({ kind: 'launched', pid: 1 })
	vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
})

describe('run_ship_return.return_control', () => {
	it('records the stopped stage as a ship-stop position naming the issue', async () => {
		await run_ship_return.return_control(ISSUE, 'gate')

		expect(emit_mock).toHaveBeenCalledWith(
			'ship-stop',
			`#${ISSUE} gate failed — pnpm josh ship --log ${ISSUE}`,
		)
	})

	it('relaunches the lane child with the ship-stop prompt at the implementation phase', async () => {
		expect(await run_ship_return.return_control(ISSUE, 'review')).toBe('relaunched')

		const [lane, invocation, phase] = (relaunch_mock.mock.calls[0] ?? []) as ReadonlyArray<unknown>

		expect(lane).toBe(LANE)
		expect(String(invocation)).toContain('ship supervisor stopped')
		expect(String(invocation).endsWith(`fullrun #${ISSUE}`)).toBe(true)
		expect(phase).toBe('implementation')
	})

	it('relaunches nothing outside a dispatched lane child', async () => {
		is_child_mock.mockReturnValue(false)

		expect(await run_ship_return.return_control(ISSUE, 'gate')).toBe('recorded')
		expect(relaunch_mock).not.toHaveBeenCalled()
	})

	it('leaves an OpenAI lane to its own supervisor', async () => {
		find_lane_mock.mockResolvedValue({ ...LANE, profile: { provider: 'openai' } })

		expect(await run_ship_return.return_control(ISSUE, 'followup')).toBe('recorded')
		expect(relaunch_mock).not.toHaveBeenCalled()
	})

	it('still records the stop when the relaunch could not start', async () => {
		relaunch_mock.mockReturnValue({ kind: 'failed', note: 'no claude' })

		expect(await run_ship_return.return_control(ISSUE, 'commit')).toBe('recorded')
		expect(emit_mock).toHaveBeenCalledTimes(1)
	})
})
