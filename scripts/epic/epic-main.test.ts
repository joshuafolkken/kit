import { main_entry_fixture } from '#scripts/josh/main-entry-fixture'
import { describe, expect, it, vi } from 'vitest'
import type { epic_command } from './epic'

const { run } = vi.hoisted(() => ({ run: vi.fn() }))

vi.mock('./epic', () => ({ epic_command: { run } }))

const ENTRY = 'scripts/epic/epic-main.ts'
const CASES = main_entry_fixture.entry_cases({
	command: 'epic',
	entry: ENTRY,
	library: 'scripts/epic/epic.ts',
	run,
})
const FAILURE_EXIT_CODE = 1

describe('epic-main', () => {
	it.each(CASES)('%s', async (_name, check) => {
		await check()
	})

	// `run:split` imports `epic.ts` in its own process (joshuafolkken/kit#5912): a module that ran its
	// command on import would exit the test run here.
	it('leaves epic.ts importable without running a command', async () => {
		const actual: { epic_command: typeof epic_command } =
			await vi.importActual('#scripts/epic/epic')

		expect(actual.epic_command.run).toBeTypeOf('function')
	})

	it('prints a thrown failure as one line and answers 1', async () => {
		const error_spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

		run.mockReset()
		run.mockRejectedValue(new Error('gh: not authenticated'))

		expect(await main_entry_fixture.run_entry(ENTRY, main_entry_fixture.ARGUMENTS)).toBe(
			FAILURE_EXIT_CODE,
		)
		expect(error_spy).toHaveBeenCalledWith('✖ gh: not authenticated')
		error_spy.mockRestore()
	})
})
