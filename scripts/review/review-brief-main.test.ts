import { main_entry_fixture } from '#scripts/josh/main-entry-fixture'
import { describe, it, vi } from 'vitest'

const { run } = vi.hoisted(() => ({ run: vi.fn() }))

vi.mock('./review-brief-cli', () => ({ review_brief_cli: { run } }))

const CASES = main_entry_fixture.entry_cases({
	command: 'review:brief',
	entry: 'scripts/review/review-brief-main.ts',
	library: 'scripts/review/review-brief-cli.ts',
	run,
})

describe('review-brief-main', () => {
	it.each(CASES)('%s', async (_name, check) => {
		await check()
	})
})
