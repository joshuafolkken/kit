import path from 'node:path'
import { repository_labels } from '#scripts/repo/repository-labels'
import { execaSync } from 'execa'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { main as init_main } from './init'
import { PACKAGE_DIR } from './init-paths'
import type { ProjectShape } from './project-profile'
import { start_steps, type StepContext } from './start-steps'

vi.mock('execa', () => ({ execaSync: vi.fn() }))
vi.mock('./init', () => ({ main: vi.fn() }))
vi.mock('#scripts/repo/repository-labels', () => ({
	repository_labels: { ensure_labels: vi.fn() },
}))

const mocked_execa = vi.mocked(execaSync)
const GIT_ADD_ALL = 'git add --all'
const ROOT = path.join(path.sep, 'work', 'my-site')
const CONTEXT: StepContext = { root: ROOT, profile: 'basic', visibility: 'private' }
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

		expect(start_steps.read_git_state(ROOT, SHAPE)).toStrictEqual({
			has_git: true,
			has_github: false,
			has_origin: true,
			branch: 'main',
			has_commits: false,
		})
	})

	it('runs no git command without a repository', () => {
		start_steps.read_git_state(ROOT, { ...SHAPE, has_git: false })

		expect(mocked_execa).not.toHaveBeenCalled()
	})
})

describe('the steps josh start runs', () => {
	it('creates main, commits and pushes a private repository named after the directory', () => {
		start_steps.run_steps(['git_init', 'commit', 'repository'], CONTEXT)

		expect(commands()).toStrictEqual([
			'git init --initial-branch=main',
			GIT_ADD_ALL,
			'git commit --no-verify --message Initial commit',
			'git branch --move --force main',
			'gh repo create my-site --private --source . --remote origin --push',
		])
	})

	it('initializes through the same entry point as josh init, with the confirmed profile', () => {
		start_steps.run_steps(['initialize'], { ...CONTEXT, profile: 'full' })

		expect(init_main).toHaveBeenCalledWith(['--profile', 'full'])
		expect(mocked_execa).not.toHaveBeenCalled()
	})

	// The initialize step installs, so the commit after it carries the lockfile (#2766).
	it('does not opt out of the install, so the initial commit carries the lockfile', () => {
		start_steps.run_steps(['initialize', 'commit'], CONTEXT)

		expect(vi.mocked(init_main).mock.calls[0]?.[0]).not.toContain('--no-install')
		expect(commands()).toContain(GIT_ADD_ALL)
	})
})

describe('the labels and failures of josh start', () => {
	// Which labels are missing and how a failure is reported is `repository-labels.test.ts`'s.
	it('provisions the labels through the shared step, on the repository gh resolves here', () => {
		start_steps.run_steps(['labels'], CONTEXT)

		expect(repository_labels.ensure_labels).toHaveBeenCalledWith('{owner}/{repo}')
		expect(mocked_execa).not.toHaveBeenCalled()
	})

	it('reports how far it got when a step fails', () => {
		mocked_execa.mockImplementation((command) => {
			if (command === 'gh') throw new Error('name already exists')

			return result(0)
		})

		expect(() => {
			start_steps.run_steps(['git_init', 'repository'], CONTEXT)
		}).toThrow(
			/stopped at: Create the GitHub repository[\s\S]*Completed: Create a Git repository[\s\S]*name already exists/u,
		)
	})
})
