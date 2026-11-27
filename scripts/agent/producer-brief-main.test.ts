import { main_entry_fixture } from '#scripts/josh/main-entry-fixture'
import { describe, it, vi } from 'vitest'

const { run } = vi.hoisted(() => ({ run: vi.fn() }))

vi.mock('./producer-brief', () => ({ producer_brief: { run } }))

const CASES = main_entry_fixture.entry_cases({
	command: 'producer:brief',
	entry: 'scripts/agent/producer-brief-main.ts',
	library: 'scripts/agent/producer-brief.ts',
	run,
})

describe('producer-brief-main', () => {
	it.each(CASES)('%s', async (_name, check) => {
		await check()
	})
})
