import { launch_timing } from '#scripts/lane/launch-timing'
import { beforeEach, describe, expect, it } from 'vitest'
import { run_board_cli } from './run-board-cli'
import { run_board_fixture } from './run-board-fixture'
import { run_board_timing } from './run-board-timing'

// joshuafolkken/kit#7929: `run:board --timing` says what the first board waited on, phase by phase.

const { STOPPED, harness } = run_board_fixture
const { FIRST_FRAME_PHASE, FIRST_READ_PHASE, TIMING_FLAG, report, split } = run_board_timing
const HEADING = 'run:board timing (ms):'
const REBUILD_MS = 812.4

beforeEach(() => {
	launch_timing.clear()
})

describe('run_board_timing.split', () => {
	it('takes the flag out wherever it stands', () => {
		expect(split(['--once', TIMING_FLAG])).toStrictEqual({ argv: ['--once'], is_timing: true })
	})

	it('leaves an argv without it as it came', () => {
		expect(split(['--once'])).toStrictEqual({ argv: ['--once'], is_timing: false })
	})
})

describe('run_board_timing.report', () => {
	it('says the launcher rebuild and each phase by name, in whole ms', () => {
		launch_timing.set_rebuild_ms(REBUILD_MS)
		launch_timing.mark('local: lanes', 2.6)

		expect(report()).toBe(`${HEADING}\n  rebuild       812\n  local: lanes  3\n`)
	})
})

describe('run_board_cli.run --timing', () => {
	it('says the first read and the first frame after a single frame', async () => {
		const { ports, frames } = harness(undefined, [])

		await expect(run_board_cli.run(['--once', TIMING_FLAG], ports)).resolves.toBe(0)

		expect(frames).toHaveLength(2)
		expect(frames[1]).toContain(HEADING)
		expect(frames[1]).toContain(FIRST_READ_PHASE)
		expect(frames[1]).toContain(FIRST_FRAME_PHASE)
	})

	it('says them on the normal screen after a live board leaves its own', async () => {
		const { ports, frames, leaves } = harness(undefined, [])

		await expect(run_board_cli.run([TIMING_FLAG], ports)).rejects.toBe(STOPPED)
		leaves[0]?.()

		expect(frames.at(-1)).toContain(FIRST_FRAME_PHASE)
		expect(frames.at(-2)).not.toContain(HEADING)
	})

	it('says nothing of timing after a single frame without the flag', async () => {
		const { ports, frames } = harness(undefined, [])

		await run_board_cli.run(['--once'], ports)

		expect(frames.join('')).not.toContain(HEADING)
	})

	it('says nothing of timing as a live board leaves without the flag', async () => {
		const { ports, frames, leaves } = harness(undefined, [])

		await expect(run_board_cli.run([], ports)).rejects.toBe(STOPPED)
		leaves[0]?.()

		expect(frames.join('')).not.toContain(HEADING)
	})
})
