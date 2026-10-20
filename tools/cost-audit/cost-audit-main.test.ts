import { main_entry_fixture } from '#scripts/josh/main-entry-fixture'
import { describe, it, vi } from 'vitest'

const { run } = vi.hoisted(() => ({ run: vi.fn() }))

vi.mock('./cost-audit-cli', () => ({ cost_audit_cli: { run } }))

const CASES = main_entry_fixture.entry_cases({
	command: 'cost:audit',
	entry: 'tools/cost-audit/cost-audit-main.ts',
	library: 'tools/cost-audit/cost-audit-cli.ts',
	run,
})

describe('cost-audit-main', () => {
	it.each(CASES)('%s', async (_name, check) => {
		await check()
	})
})
