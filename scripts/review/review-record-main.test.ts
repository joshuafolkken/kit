import { main_entry_fixture } from '#scripts/josh/main-entry-fixture'
import { describe, expect, it, vi } from 'vitest'

const { run } = vi.hoisted(() => ({ run: vi.fn() }))

vi.mock('./review-record-cli', () => ({ review_record_cli: { run } }))

const CASES = main_entry_fixture.entry_cases({
	command: 'review:record',
	entry: 'scripts/review/review-record-main.ts',
	library: 'scripts/review/review-record-cli.ts',
	run,
	called_with: [main_entry_fixture.ARGUMENTS, expect.any(Date)],
})

describe('review-record-main', () => {
	it.each(CASES)('%s', async (_name, check) => {
		await check()
	})
})
