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
vi.mock('./run-ship', () => ({ run_ship: { exit_code: () => 0 } }))
vi.mock('#scripts/run/run-step-section', () => ({
	run_step_section: { print_once: print_once_mock },
}))

const ISSUE = 5626
const REPOSITORY = '/repo'
const PRINT_FAILURE = 1
const args = { number: ISSUE } as unknown as ShipArguments
const sections: ReadonlyArray<ShipSection> = []

beforeEach(() => {
	vi.clearAllMocks()
	detach_mock.is_supervised.mockReturnValue(true)
	repository_mock.mockResolvedValue(REPOSITORY)
	print_once_mock.mockReturnValue(0)
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
