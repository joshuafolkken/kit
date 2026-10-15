import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { start } from './start'
import type { GitState } from './start-plan'
import { start_steps } from './start-steps'
import { working_tree_fixture } from './working-tree-fixture'

const { MANIFEST, committed_repository, git, remove_all, repository, write } = working_tree_fixture
const DIRTY_REFUSAL = 'josh start refuses to run'
const STATUS = ['status', '--porcelain']
const EDITED_MANIFEST = '{ "name": "fixture", "private": true }\n'
const SETUP_BRANCH = '7-set-up-joshuafolkken-kit'
const UNATTENDED = ['--yes', '--github']
const COMMITTED: GitState = {
	has_git: true,
	has_github: false,
	has_origin: false,
	branch: 'main',
	has_commits: true,
	has_kit_committed: false,
}

function discard_output(): void {
	// intentionally silent
}

// The real plan and refusals run against a real repository; only GitHub and the steps themselves are
// stubbed, so a run that gets past every refusal reaches `run_steps` without writing anything.
async function run_start(root: string): Promise<{ code: number; message: string }> {
	vi.spyOn(process, 'cwd').mockReturnValue(root)
	const error_spy = vi.spyOn(console, 'error').mockImplementation(discard_output)
	const code = await start.run(UNATTENDED, false)

	return { code, message: error_spy.mock.calls.flat().join('\n') }
}

beforeEach(() => {
	vi.spyOn(console, 'info').mockImplementation(discard_output)
	vi.spyOn(start_steps, 'github_cli_refusal').mockReturnValue(undefined)
	vi.spyOn(start_steps, 'git_identity_refusal').mockReturnValue(undefined)
	vi.spyOn(start_steps, 'run_steps').mockResolvedValue(undefined)
})

afterEach(() => {
	vi.restoreAllMocks()
	remove_all()
})

describe('josh start — a working tree with uncommitted changes (#3835)', () => {
	it('refuses before any step, naming the change, and leaves the tree as it was', async () => {
		const root = committed_repository()

		write(root, MANIFEST, EDITED_MANIFEST)
		const status = git(root, STATUS)
		const { code, message } = await run_start(root)

		expect(code).toBe(1)
		expect(message).toContain(DIRTY_REFUSAL)
		expect(message).toContain(`  ${MANIFEST}`)
		expect(start_steps.run_steps).not.toHaveBeenCalled()
		expect(readFileSync(path.join(root, MANIFEST), 'utf8')).toBe(EDITED_MANIFEST)
		expect(git(root, STATUS)).toBe(status)
	})

	it('lets the setup branch a failed commit left resume with that run’s output', () => {
		const root = committed_repository()

		write(root, MANIFEST, EDITED_MANIFEST)

		expect(
			start_steps.uncommitted_refusal(root, { ...COMMITTED, branch: SETUP_BRANCH }),
		).toBeUndefined()
		expect(start_steps.uncommitted_refusal(root, COMMITTED)).toContain(DIRTY_REFUSAL)
	})
})

describe('josh start — nothing uncommitted to protect', () => {
	it('runs on in a clean repository', async () => {
		const { code, message } = await run_start(committed_repository())

		expect(code).toBe(0)
		expect(message).not.toContain(DIRTY_REFUSAL)
		expect(start_steps.run_steps).toHaveBeenCalledWith(
			expect.arrayContaining(['setup_pr']),
			expect.anything(),
		)
	})

	it('runs on in a repository without a commit, whose initial commit takes every file', async () => {
		const root = repository()

		write(root, MANIFEST, EDITED_MANIFEST)
		const { code, message } = await run_start(root)

		expect(code).toBe(0)
		expect(message).not.toContain(DIRTY_REFUSAL)
		expect(start_steps.run_steps).toHaveBeenCalledWith(
			expect.arrayContaining(['commit']),
			expect.anything(),
		)
	})
})
