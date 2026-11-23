import { import_closure } from '#scripts/build/import-closure-fixture'
import { main_entry_fixture } from '#scripts/josh/main-entry-fixture'
import { describe, expect, it, vi } from 'vitest'

// The records are a sentinel rather than the real ones: the fixture re-imports the entry, and the
// real records carry functions that a fresh module instance would not share.
const { run, DEFAULT_RECORDS } = vi.hoisted(() => ({ run: vi.fn(), DEFAULT_RECORDS: {} }))

vi.mock('./gate-command', () => ({ gate_command: { run_gate_command: run } }))
vi.mock('./check-reuse', () => ({ check_reuse: { DEFAULT_RECORDS } }))

const CASES = main_entry_fixture.entry_cases({
	command: 'gate',
	entry: 'scripts/gate/gate-main.ts',
	library: 'scripts/gate/gate-command.ts',
	run,
	called_with: [
		main_entry_fixture.ARGUMENTS,
		expect.objectContaining({ check_records: DEFAULT_RECORDS }),
	],
})

describe('gate-main', () => {
	it.each(CASES)('%s', async (_name, check) => {
		await check()
	})

	// The gate itself is imported by every gate suite and by `gate-command.ts`, so its old main guard
	// stays gone (joshuafolkken/kit#8844).
	it('leaves the gate module without a main guard', () => {
		expect(import_closure.has_main_guard('scripts/gate/verification-gate.ts')).toBe(false)
	})
})
