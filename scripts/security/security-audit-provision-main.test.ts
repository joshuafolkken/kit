import { HOOK_BUNDLES } from '#scripts/build/build-hooks'
import { main_entry_fixture } from '#scripts/josh/main-entry-fixture'
import { describe, expect, it, vi } from 'vitest'

const { run, pin, record_from_stdin } = vi.hoisted(() => ({
	run: vi.fn(),
	pin: vi.fn(),
	record_from_stdin: vi.fn(),
}))

vi.mock('./security-audit-provision', () => ({ security_audit_provision: { run } }))
vi.mock('#scripts/discovery/session-owner-pin', () => ({ session_owner_pin: { pin } }))
vi.mock('#scripts/josh/session-model-record', () => ({
	session_model_record: { record_from_stdin },
}))

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

	it('pins the owner and records the model only at session start', async () => {
		await main_entry_fixture.run_entry(ENTRY, [])

		expect(record_from_stdin).not.toHaveBeenCalled()

		await main_entry_fixture.run_entry(ENTRY, ['--session-start'])

		expect(pin).toHaveBeenCalledOnce()
		expect(record_from_stdin).toHaveBeenCalledOnce()
	})

	it('is the source the session-start hook bundle is built from', () => {
		expect(HOOK_BUNDLES).toContainEqual({ source: ENTRY, out: 'audit-provision' })
	})
})
