import { HOOK_BUNDLES } from '#scripts/build/build-hooks'
import { main_entry_fixture } from '#scripts/josh/main-entry-fixture'
import { describe, expect, it, vi } from 'vitest'

const { run } = vi.hoisted(() => ({ run: vi.fn() }))

vi.mock('./security-audit-provision', () => ({ security_audit_provision: { run } }))

const ENTRY = 'scripts/security/security-audit-provision-main.ts'

const CASES = main_entry_fixture.entry_cases({
	command: 'audit:provision',
	entry: ENTRY,
	library: 'scripts/security/security-audit-provision.ts',
	run,
	has_own_exit_code: true,
})

describe('security-audit-provision-main', () => {
	it.each(CASES)('%s', async (_name, check) => {
		await check()
	})

	it('is the source the session-start hook bundle is built from', () => {
		expect(HOOK_BUNDLES).toContainEqual({ source: ENTRY, out: 'audit-provision' })
	})
})
