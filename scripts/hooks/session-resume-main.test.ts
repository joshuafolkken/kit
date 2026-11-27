import { main_entry_fixture } from '#scripts/josh/main-entry-fixture'
import { describe, it, vi } from 'vitest'

const { run } = vi.hoisted(() => ({ run: vi.fn() }))

vi.mock('./no-filing-declaration', () => ({ no_filing_declaration: { end_on_resume: run } }))

const CASES = main_entry_fixture.entry_cases({
	command: 'session:resume',
	entry: 'scripts/hooks/session-resume-main.ts',
	library: 'scripts/hooks/no-filing-declaration.ts',
	run,
	called_with: [],
	has_own_exit_code: true,
})

describe('session-resume-main', () => {
	it.each(CASES)('%s', async (_name, check) => {
		await check()
	})
})
