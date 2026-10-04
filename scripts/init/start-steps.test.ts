import path from 'node:path'
import { repository_labels } from '#scripts/repo/repository-labels'
import { execaSync } from 'execa'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { main as init_main } from './init'
import { PACKAGE_DIR } from './init-paths'
import type { ProjectShape } from './project-profile'
import { start_setup_pr } from './start-setup-pr'
import { start_steps, type StepContext } from './start-steps'

vi.mock(import('execa'), async (import_original) => ({
	...(await import_original()),
	execaSync: vi.fn(),
}))
vi.mock('./init', () => ({ main: vi.fn() }))
vi.mock('#scripts/repo/repository-labels', () => ({
	repository_labels: { ensure_labels: vi.fn() },
}))
vi.mock('./start-setup-pr', () => ({ start_setup_pr: { open: vi.fn(), changed_paths: vi.fn() } }))

const mocked_execa = vi.mocked(execaSync)
const GIT_ADD_ALL = 'git add --all'
const ROOT = path.join(path.sep, 'work', 'my-site')
const CONTEXT: StepContext = {
	root: ROOT,
	profile: 'basic',
	visibility: 'private',
	init_command: undefined,
}
const INIT_COMMAND = 'josh-app init --verbose'
const SHAPE: ProjectShape = {
	profile: 'basic',
	reason: 'test',
	has_web: true,
	has_typescript: false,
	has_git: true,
	has_github: false,
}

function result(exit_code: number, stdout = ''): ReturnType<typeof execaSync> {
	const value: unknown = { exitCode: exit_code, stdout }

	return value as ReturnType<typeof execaSync>
}

function commands(): Array<string> {
	return mocked_execa.mock.calls.map((call) => {
		const args: ReadonlyArray<unknown> = Array.isArray(call[1]) ? call[1] : []

		return [call[0], ...args].join(' ')
	})
}

beforeEach(() => {
	mocked_execa.mockReset()
	mocked_execa.mockReturnValue(result(0))
	vi.mocked(init_main).mockReset()
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
})

describe('the GitHub CLI prerequisite', () => {
	it('explains how to install gh when it is missing', () => {
		mocked_execa.mockReturnValueOnce(result(1))

		expect(start_steps.github_cli_refusal(ROOT)).toContain('https://cli.github.com/')
	})

	it('explains how to sign in when gh is not authenticated', () => {
		mocked_execa.mockReturnValueOnce(result(0)).mockReturnValueOnce(result(1))

		expect(start_steps.github_cli_refusal(ROOT)).toContain('gh auth login')
	})

	it('passes an installed, signed-in gh', () => {
		expect(start_steps.github_cli_refusal(ROOT)).toBeUndefined()
	})
})

describe('the kit source repository guard', () => {
	it('refuses the kit source repository, where josh init would silently do nothing', () => {
		expect(start_steps.self_run_refusal(PACKAGE_DIR)).toContain('own repository')
	})

	it('passes any other directory', () => {
		expect(start_steps.self_run_refusal(ROOT)).toBeUndefined()
	})
})

describe('reading the Git state', () => {
	it('reads the origin, the branch and whether HEAD exists', () => {
		mocked_execa
			.mockReturnValueOnce(result(0))
			.mockReturnValueOnce(result(0, 'main\n'))
			.mockReturnValueOnce(result(1))
			.mockReturnValueOnce(result(1))

		expect(start_steps.read_git_state(ROOT, SHAPE)).toStrictEqual({
			has_git: true,
			has_github: false,
			has_origin: true,
			branch: 'main',
			has_commits: false,
			has_kit_committed: false,
		})
	})

	it('reads the origin from its configured URL and an unset one as no origin', () => {
		mocked_execa.mockReturnValueOnce(result(1))

		expect(start_steps.read_git_state(ROOT, SHAPE).has_origin).toBe(false)
		expect(commands()[0]).toContain('config --get remote.origin.url')
	})

	it('reads whether the checked-out commit records kit (#2816)', () => {
		mocked_execa.mockReturnValue(result(0, '{"devDependencies":{"@joshuafolkken/kit":"1.0.0"}}'))

		expect(start_steps.read_git_state(ROOT, SHAPE).has_kit_committed).toBe(true)
	})

	it('runs no git command without a repository', () => {
		start_steps.read_git_state(ROOT, { ...SHAPE, has_git: false })

		expect(mocked_execa).not.toHaveBeenCalled()
	})
})

describe('the steps josh start runs', () => {
	it('creates main, commits and pushes a private repository named after the directory', async () => {
		await start_steps.run_steps(['git_init', 'commit', 'repository'], CONTEXT)

		expect(commands()).toStrictEqual([
			'git init --initial-branch=main',
			GIT_ADD_ALL,
			'git commit --no-verify --message Initial commit',
			'git branch --move --force main',
			'gh repo create my-site --private --source . --remote origin --push',
		])
	})

	it('initializes through the same entry point as josh init, with the confirmed profile', async () => {
		await start_steps.run_steps(['initialize'], { ...CONTEXT, profile: 'full' })

		expect(init_main).toHaveBeenCalledWith(['--profile', 'full'])
		expect(mocked_execa).not.toHaveBeenCalled()
	})

	// The initialize step installs, so the commit after it carries the lockfile (#2766).
	it('does not opt out of the install, so the initial commit carries the lockfile', async () => {
		await start_steps.run_steps(['initialize', 'commit'], CONTEXT)

		expect(vi.mocked(init_main).mock.calls[0]?.[0]).not.toContain('--no-install')
		expect(commands()).toContain(GIT_ADD_ALL)
	})
})

describe('an initialize step handed to a caller command (#2872)', () => {
	it('runs the command in the root with the confirmed profile instead of josh init', async () => {
		await start_steps.run_steps(['initialize'], { ...CONTEXT, init_command: INIT_COMMAND })

		expect(commands()).toStrictEqual(['josh-app init --verbose --profile basic'])
		const call: ReadonlyArray<unknown> = mocked_execa.mock.calls[0] ?? []

		expect(call[2]).toMatchObject({ cwd: ROOT, stdio: 'inherit' })
		expect(init_main).not.toHaveBeenCalled()
	})

	it('names the command in the progress line', async () => {
		await start_steps.run_steps(['initialize'], { ...CONTEXT, init_command: INIT_COMMAND })

		expect(console.info).toHaveBeenCalledWith(`\n[1/1] Initialize with ${INIT_COMMAND}`)
	})

	it('stops before the commit when the command fails', async () => {
		mocked_execa.mockImplementation((command) => {
			if (command === 'josh-app') throw new Error('Command failed with exit code 1')

			return result(0)
		})
		const context = { ...CONTEXT, init_command: INIT_COMMAND }

		await expect(start_steps.run_steps(['initialize', 'commit'], context)).rejects.toThrow(
			/stopped at: Initialize with josh-app init[\s\S]*Completed: nothing[\s\S]*exit code 1/u,
		)
		expect(commands()).not.toContain(GIT_ADD_ALL)
	})
})

describe('the labels and failures of josh start', () => {
	// Which labels are missing and how a failure is reported is `repository-labels.test.ts`'s.
	it('provisions the labels through the shared step, on the repository gh resolves here', async () => {
		await start_steps.run_steps(['labels'], CONTEXT)

		expect(repository_labels.ensure_labels).toHaveBeenCalledWith('{owner}/{repo}')
		expect(mocked_execa).not.toHaveBeenCalled()
	})

	it('opens the setup pull request through its own step, in the project root (#2816)', async () => {
		vi.mocked(start_setup_pr.changed_paths).mockReturnValue([])
		await start_steps.run_steps(['setup_pr'], CONTEXT)

		expect(start_setup_pr.open).toHaveBeenCalledWith(ROOT, [])
	})

	it('hands the setup pull request what was changed before a caller command ran (#2872)', async () => {
		vi.mocked(start_setup_pr.changed_paths).mockReturnValue(['notes.md'])
		const context = { ...CONTEXT, init_command: INIT_COMMAND }

		await start_steps.run_steps(['initialize', 'setup_pr'], context)

		expect(start_setup_pr.open).toHaveBeenCalledWith(ROOT, ['notes.md'])
	})

	it('reports how far it got when a step fails', async () => {
		mocked_execa.mockImplementation((command) => {
			if (command === 'gh') throw new Error('name already exists')

			return result(0)
		})

		await expect(start_steps.run_steps(['git_init', 'repository'], CONTEXT)).rejects.toThrow(
			/stopped at: Create the GitHub repository[\s\S]*Completed: Create a Git repository[\s\S]*name already exists/u,
		)
	})
})

describe('the baseline the setup pull request is handed (#3136)', () => {
	it('is read for kit own initialize too, so the files its format rewrote join the PR', async () => {
		vi.mocked(start_setup_pr.changed_paths).mockReturnValue(['notes.md'])

		await start_steps.run_steps(['initialize', 'setup_pr'], CONTEXT)

		expect(start_setup_pr.changed_paths).toHaveBeenCalledWith(ROOT)
		expect(start_setup_pr.open).toHaveBeenCalledWith(ROOT, ['notes.md'])
	})

	it('is not read when no setup pull request follows', async () => {
		await start_steps.run_steps(['labels'], CONTEXT)

		expect(start_setup_pr.changed_paths).not.toHaveBeenCalled()
	})
})
