import { main_entry_fixture } from '#scripts/josh/main-entry-fixture'
import { describe, it, vi } from 'vitest'

const { run } = vi.hoisted(() => ({ run: vi.fn() }))

vi.mock('./upstream-interrupt-cli', () => ({ upstream_interrupt_cli: { run } }))

const CASES = main_entry_fixture.entry_cases({
	command: 'upstream:interrupt',
	entry: 'scripts/issue/upstream-interrupt-main.ts',
	library: 'scripts/issue/upstream-interrupt-cli.ts',
	run,
})

describe('upstream-interrupt-main', () => {
	it.each(CASES)('%s', async (_name, check) => {
		await check()
	})
})
