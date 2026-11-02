import { main_entry_fixture } from '#scripts/josh/main-entry-fixture'
import { describe, it, vi } from 'vitest'

const { run } = vi.hoisted(() => ({ run: vi.fn() }))

vi.mock('./epic-audit-cli', () => ({ epic_audit_cli: { run } }))

// `run:split` imports `epic-audit-cli.ts` in its own process, so the main guard lives in this entry
// (joshuafolkken/kit#5912).
const CASES = main_entry_fixture.entry_cases({
	command: 'epic:audit',
	entry: 'scripts/epic/epic-audit-main.ts',
	library: 'scripts/epic/epic-audit-cli.ts',
	run,
})

describe('epic-audit-main', () => {
	it.each(CASES)('%s', async (_name, check) => {
		await check()
	})
})
