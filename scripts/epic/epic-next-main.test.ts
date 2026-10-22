import { main_entry_fixture } from '#scripts/josh/main-entry-fixture'
import { describe, expect, it, vi } from 'vitest'

const { run, load_environment_file } = vi.hoisted(() => ({
	run: vi.fn(),
	load_environment_file: vi.fn(),
}))

vi.mock('./epic-next', () => ({ epic_next: { run } }))
vi.mock('#scripts/josh/josh-environment-file', () => ({
	josh_environment_file: { load_environment_file },
}))

const ENTRY = 'scripts/epic/epic-next-main.ts'

const CASES = main_entry_fixture.entry_cases({
	command: 'epic:next',
	entry: ENTRY,
	library: 'scripts/epic/epic-next.ts',
	run,
})

describe('epic-next-main', () => {
	it.each(CASES)('%s', async (_name, check) => {
		await check()
	})

	it('reads .env before it runs the command', async () => {
		load_environment_file.mockReset()

		await main_entry_fixture.run_entry(ENTRY, [])

		expect(load_environment_file).toHaveBeenCalledOnce()
	})
})
