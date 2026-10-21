import { main_entry_fixture } from '#scripts/josh/main-entry-fixture'
import { describe, it, vi } from 'vitest'

const { run } = vi.hoisted(() => ({ run: vi.fn() }))

vi.mock('./security-audit', () => ({ security_audit: { run } }))

const CASES = main_entry_fixture.entry_cases({
	command: 'audit',
	entry: 'scripts/security/security-audit-main.ts',
	library: 'scripts/security/security-audit.ts',
	run,
	called_with: [],
})

describe('security-audit-main', () => {
	it.each(CASES)('%s', async (_name, check) => {
		await check()
	})
})
