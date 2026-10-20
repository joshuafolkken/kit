import { main_entry_fixture } from '#scripts/josh/main-entry-fixture'
import { describe, it, vi } from 'vitest'

const { run } = vi.hoisted(() => ({ run: vi.fn() }))

vi.mock('./issue-comment-cli', () => ({ issue_comment_cli: { run } }))

const CASES = main_entry_fixture.entry_cases({
	command: 'issue:comment',
	entry: 'scripts/issue/issue-comment-main.ts',
	library: 'scripts/issue/issue-comment-cli.ts',
	run,
})

describe('issue-comment-main', () => {
	it.each(CASES)('%s', async (_name, check) => {
		await check()
	})
})
