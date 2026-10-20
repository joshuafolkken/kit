import { main_entry_fixture } from '#scripts/josh/main-entry-fixture'
import { describe, it, vi } from 'vitest'

const { run } = vi.hoisted(() => ({ run: vi.fn() }))

vi.mock('./issue-lint-cli', () => ({ issue_lint_cli: { run } }))

// `issue:lint` reads one path, so only the first argument reaches `run`.
const CASES = main_entry_fixture.entry_cases({
	command: 'issue:lint',
	entry: 'scripts/issue/issue-lint-main.ts',
	library: 'scripts/issue/issue-lint-cli.ts',
	run,
	called_with: [main_entry_fixture.ARGUMENTS[0]],
})

describe('issue-lint-main', () => {
	it.each(CASES)('%s', async (_name, check) => {
		await check()
	})
})
