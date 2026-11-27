import { main_entry_fixture } from '#scripts/josh/main-entry-fixture'
import { describe, it, vi } from 'vitest'

const { run } = vi.hoisted(() => ({ run: vi.fn() }))

vi.mock('./git-checkpoint', () => ({ git_checkpoint: { run } }))

const CASES = main_entry_fixture.entry_cases({
	command: 'git:checkpoint',
	entry: 'scripts/git/git-checkpoint-main.ts',
	library: 'scripts/git/git-checkpoint.ts',
	run,
})

describe('git-checkpoint-main', () => {
	it.each(CASES)('%s', async (_name, check) => {
		await check()
	})
})
