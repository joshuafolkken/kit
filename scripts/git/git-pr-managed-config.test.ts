import {
	DISTRIBUTED_ROOT_FILE,
	DISTRIBUTED_SKILL_FILE,
	DISTRIBUTED_SYNC_ARTIFACT,
} from '#scripts/managed-config-fixture'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { git_command } from './git-command'
import { git_pr_managed_config } from './git-pr-managed-config'

// `./git-command` rather than `./changed-paths`: this reads the **tracked** branch diff and lets the
// shared helper split the lines, so mocking the helper would stub the very splitting under test.
vi.mock('./git-command', () => ({
	git_command: { diff_main_names: vi.fn() },
}))

// The distribution lists themselves are **not** mocked: the defect joshuafolkken/kit#1578 records is
// a real path failing to be matched, so this is exercised against the lists it will run against in
// production. Only the diff read is stubbed.
const UNDISTRIBUTED_FILE = 'scripts/git/git-pr-managed-config.ts'

const mocked_diff_main_names = vi.mocked(git_command.diff_main_names)

const DIFF_LINE_SEPARATOR = '\n'

function given_changed(paths: ReadonlyArray<string>): void {
	mocked_diff_main_names.mockResolvedValue(paths.join(DIFF_LINE_SEPARATOR))
}

async function run_report(): Promise<Array<string>> {
	return await git_pr_managed_config.handle_managed_config_changes({ should_merge: true })
}

function joined(lines: ReadonlyArray<string>): string {
	return lines.join(DIFF_LINE_SEPARATOR)
}

beforeEach(() => {
	vi.clearAllMocks()
})

describe('handle_managed_config_changes — a diff that distributes nothing', () => {
	it('reports nothing at all, so the completion report gains no section', async () => {
		given_changed([UNDISTRIBUTED_FILE])

		await expect(run_report()).resolves.toEqual([])
	})

	it('reports nothing for an empty diff', async () => {
		given_changed([])

		await expect(run_report()).resolves.toEqual([])
	})
})

// joshuafolkken/kit#1592. Every assertion here is `resolves`, and that is the point of the change:
// this used to throw, which ended the run before the CI wait and needed a reason typed by hand to get
// past. In kit the condition is nearly always true — kit is the distribution source — so the stop was
// firing on changes the Issues themselves had ordered.
describe('handle_managed_config_changes — a distributed file', () => {
	it('does not stop the run', async () => {
		given_changed([DISTRIBUTED_ROOT_FILE])

		await expect(run_report()).resolves.not.toEqual([])
	})

	it('names the distributed path in the report', async () => {
		given_changed([DISTRIBUTED_ROOT_FILE])

		expect(joined(await run_report())).toContain(DISTRIBUTED_ROOT_FILE)
	})

	// The whole of joshuafolkken/kit#1578: this path matches no list entry textually, so an eye
	// comparison against the arrays misses it. The matching is unchanged by #1592 — only the stop went.
	it('finds a file under a distributed directory it does not textually equal', async () => {
		given_changed([UNDISTRIBUTED_FILE, DISTRIBUTED_SKILL_FILE])

		expect(joined(await run_report())).toContain(DISTRIBUTED_SKILL_FILE)
	})

	it('names the list that claimed the path', async () => {
		given_changed([DISTRIBUTED_SKILL_FILE])

		expect(joined(await run_report())).toContain('PLUGIN_SKILL_DIRECTORIES')
	})
})

// Reading only the three `AI_COPY_*` lists was narrower than the prose it replaced, whose own worked
// example is this file (joshuafolkken/kit#1578).
describe('handle_managed_config_changes — a file josh sync writes outside the AI_COPY lists', () => {
	it('reports a path no AI_COPY list holds', async () => {
		given_changed([DISTRIBUTED_SYNC_ARTIFACT])

		expect(joined(await run_report())).toContain(DISTRIBUTED_SYNC_ARTIFACT)
	})

	it('names the source that claimed it', async () => {
		given_changed([DISTRIBUTED_SYNC_ARTIFACT])

		expect(joined(await run_report())).toContain('SYNCED_PATHS')
	})
})

// `--no-merge` ends with the pull request open and nothing landed on the default branch, so there is
// no distribution yet to report. The report belongs to the run that actually merges.
async function run_without_merge(): Promise<Array<string>> {
	return await git_pr_managed_config.handle_managed_config_changes({ should_merge: false })
}

describe('handle_managed_config_changes — a run that is not merging', () => {
	it('reports nothing even on a distributed change', async () => {
		given_changed([DISTRIBUTED_ROOT_FILE])

		await expect(run_without_merge()).resolves.toEqual([])
	})

	it('reads no diff at all', async () => {
		given_changed([DISTRIBUTED_ROOT_FILE])
		await run_without_merge()

		expect(mocked_diff_main_names).not.toHaveBeenCalled()
	})
})
