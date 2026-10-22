import { main_entry_fixture } from '#scripts/josh/main-entry-fixture'
import { describe, it, vi } from 'vitest'

const { run } = vi.hoisted(() => ({ run: vi.fn() }))

vi.mock('./backlog-offer-cli', () => ({ backlog_offer_cli: { run } }))

const CASES = main_entry_fixture.entry_cases({
	command: 'backlog:offer',
	entry: 'scripts/backlog/backlog-offer-main.ts',
	library: 'scripts/backlog/backlog-offer-cli.ts',
	run,
})

describe('backlog-offer-main', () => {
	it.each(CASES)('%s', async (_name, check) => {
		await check()
	})
})
