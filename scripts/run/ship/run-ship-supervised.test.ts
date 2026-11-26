import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ShipSection } from './run-ship'
import type { ShipArguments } from './run-ship-steps'
import { run_ship_supervised } from './run-ship-supervised'

const detach_mock = vi.hoisted(() => ({
	is_supervised: vi.fn(() => true),
	claim_identity: vi.fn(async () => undefined),
	mark_result: vi.fn(async () => undefined),
}))
const repository_mock = vi.hoisted(() => vi.fn(async (): Promise<string | undefined> => '/repo'))
const print_once_mock = vi.hoisted(() => vi.fn((_key: string) => 0))

vi.mock('./run-ship-detach', () => ({ run_ship_detach: detach_mock }))
vi.mock('./run-ship-probe', () => ({
	run_ship_probe: { repository_directory: repository_mock },
}))
const exit_code_mock = vi.hoisted(() => vi.fn((_sections: unknown) => 0))
const close_merged_mock = vi.hoisted(() => vi.fn(async (_issue: string) => undefined))

vi.mock('./run-ship', () => ({ run_ship: { exit_code: exit_code_mock } }))
vi.mock('./run-ship-lane-close', () => ({
	run_ship_lane_close: { close_merged: close_merged_mock },
}))
vi.mock('#scripts/run/run-step-section', () => ({
	run_step_section: { print_once: print_once_mock },
}))

const ISSUE = '5626'
const REPOSITORY = '/repo'
const PRINT_FAILURE = 1
const args = { number: ISSUE } as unknown as ShipArguments
const sections: ReadonlyArray<ShipSection> = []

beforeEach(() => {
	detach_mock.is_supervised.mockReturnValue(true)
	repository_mock.mockResolvedValue(REPOSITORY)
	print_once_mock.mockReturnValue(0)
	exit_code_mock.mockReturnValue(0)
})

// joshuafolkken/kit#9038: the supervisor closes the lane after the result, never before it.
describe('run_ship_supervised.finish', () => {
	it('records the result, then closes the lane of a supervised ship that merged', async () => {
		await run_ship_supervised.finish(args, sections)

		expect(close_merged_mock).toHaveBeenCalledExactlyOnceWith(ISSUE)
		expect(detach_mock.mark_result.mock.invocationCallOrder[0]).toBeLessThan(
			close_merged_mock.mock.invocationCallOrder[0] ?? 0,
		)
	})

	it('leaves the lane of a failed ship open', async () => {
		exit_code_mock.mockReturnValue(PRINT_FAILURE)

		await run_ship_supervised.finish(args, sections)

		expect(detach_mock.mark_result).toHaveBeenCalledExactlyOnceWith(
			REPOSITORY,
			ISSUE,
			PRINT_FAILURE,
		)
		expect(close_merged_mock).not.toHaveBeenCalled()
	})

	it('closes nothing for a ship nobody detached', async () => {
		detach_mock.is_supervised.mockReturnValue(false)

		await run_ship_supervised.finish(args, sections)

		expect(close_merged_mock).not.toHaveBeenCalled()
	})
})

describe('run_ship_supervised — the detached supervisor bookkeeping', () => {
	it('claims the launch record identity under a supervisor', async () => {
		await run_ship_supervised.claim_identity(args)

		expect(detach_mock.claim_identity).toHaveBeenCalledExactlyOnceWith(REPOSITORY, ISSUE)
	})

	it('writes the result into the launch record under a supervisor', async () => {
		await run_ship_supervised.record_result(args, sections)

		expect(detach_mock.mark_result).toHaveBeenCalledExactlyOnceWith(REPOSITORY, ISSUE, 0)
	})

	it('does neither for a ship nobody detached', async () => {
		detach_mock.is_supervised.mockReturnValue(false)

		await run_ship_supervised.claim_identity(args)
		await run_ship_supervised.record_result(args, sections)

		expect(detach_mock.claim_identity).not.toHaveBeenCalled()
		expect(detach_mock.mark_result).not.toHaveBeenCalled()
		expect(repository_mock).not.toHaveBeenCalled()
	})

	it('prints no governing section into a supervisor log', () => {
		expect(run_ship_supervised.print_section()).toBe(0)
		expect(print_once_mock).not.toHaveBeenCalled()
	})

	it("prints ship's governing section, and its exit code, for a ship nobody detached", () => {
		detach_mock.is_supervised.mockReturnValue(false)
		print_once_mock.mockReturnValue(PRINT_FAILURE)

		expect(run_ship_supervised.print_section()).toBe(PRINT_FAILURE)
		expect(print_once_mock).toHaveBeenCalledExactlyOnceWith('ship')
	})
})
