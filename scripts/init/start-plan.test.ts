import { describe, expect, it } from 'vitest'
import { start_plan, type GitState, type StartOptions } from './start-plan'

const NO_GIT: GitState = {
	has_git: false,
	has_github: false,
	has_origin: false,
	branch: undefined,
	has_commits: false,
	has_kit_committed: false,
}
const OPTIONS: StartOptions = {
	profile: undefined,
	is_yes: false,
	is_github: false,
	visibility: 'private',
}
const WITH_REPOSITORY = ['initialize', 'repository'] as const
const ADD_GITHUB = 'Add --github'
// A main that already records kit, so no setup pull request is planned.
const MAIN_WITH_KIT: GitState = {
	...NO_GIT,
	branch: 'main',
	has_commits: true,
	has_kit_committed: true,
}

describe('the steps josh start plans', () => {
	it('runs every step from git init to the labels in a directory without Git', () => {
		expect(start_plan.plan_steps(NO_GIT)).toStrictEqual({
			steps: ['git_init', 'initialize', 'commit', 'repository', 'labels'],
			refusal: undefined,
		})
	})

	it('only adds labels and initializes when a GitHub origin already exists', () => {
		const state = {
			...NO_GIT,
			has_git: true,
			has_github: true,
			branch: 'feature',
			has_commits: true,
		}

		expect(start_plan.plan_steps(state).steps).toStrictEqual(['initialize', 'labels'])
	})
})

const SETUP_BRANCH = '7-set-up-joshuafolkken-kit'
const ON_GITHUB_MAIN: GitState = {
	...NO_GIT,
	has_git: true,
	has_github: true,
	has_origin: true,
	branch: 'main',
	has_commits: true,
}

describe('the setup pull request josh start plans (#2816)', () => {
	it('opens the setup pull request when main on GitHub does not hold kit yet', () => {
		expect(start_plan.plan_steps(ON_GITHUB_MAIN).steps).toStrictEqual([
			'initialize',
			'labels',
			'setup_pr',
		])
	})

	it('opens none once main holds kit', () => {
		const state = { ...ON_GITHUB_MAIN, has_kit_committed: true }

		expect(start_plan.plan_steps(state).steps).toStrictEqual(['initialize', 'labels'])
	})

	it('opens the pull request after pushing an existing main to a new repository', () => {
		const state = { ...ON_GITHUB_MAIN, has_github: false, has_origin: false }

		expect(start_plan.plan_steps(state).steps).toStrictEqual([
			'initialize',
			'repository',
			'labels',
			'setup_pr',
		])
	})
})

describe('when josh start resumes or skips the setup pull request (#2816)', () => {
	it('resumes on the setup branch a failed hook left before the commit (#2816)', () => {
		const state = { ...ON_GITHUB_MAIN, branch: SETUP_BRANCH }

		expect(start_plan.plan_steps(state).steps).toContain('setup_pr')
	})

	it('plans nothing more on the setup branch once kit is committed there', () => {
		const state = { ...ON_GITHUB_MAIN, branch: SETUP_BRANCH, has_kit_committed: true }

		expect(start_plan.plan_steps(state).steps).not.toContain('setup_pr')
	})

	it('commits a repository with no history directly, without a pull request', () => {
		const state = { ...ON_GITHUB_MAIN, has_github: false, has_origin: false, has_commits: false }

		expect(start_plan.plan_steps(state).steps).not.toContain('setup_pr')
	})
})

describe('the steps josh start plans in an existing Git repository', () => {
	it('reuses a Git repository with no commits and makes the first one', () => {
		const state = { ...NO_GIT, has_git: true, branch: 'master' }

		expect(start_plan.plan_steps(state).steps).toStrictEqual([
			'initialize',
			'commit',
			'repository',
			'labels',
		])
	})

	it('pushes an existing main without committing on the user’s behalf', () => {
		const state = { ...MAIN_WITH_KIT, has_git: true }

		expect(start_plan.plan_steps(state).steps).toStrictEqual(['initialize', 'repository', 'labels'])
	})

	it('refuses an existing history on another branch before changing anything', () => {
		const plan = start_plan.plan_steps({
			...NO_GIT,
			has_git: true,
			branch: 'dev',
			has_commits: true,
		})

		expect(plan.steps).toStrictEqual([])
		expect(plan.refusal).toContain('on dev')
	})

	it('refuses an origin that is not on GitHub before changing anything', () => {
		const plan = start_plan.plan_steps({ ...NO_GIT, has_git: true, has_origin: true })

		expect(plan.steps).toStrictEqual([])
		expect(plan.refusal).toContain('not on GitHub')
	})
})

describe('how josh start is allowed to proceed', () => {
	it('asks at a terminal', () => {
		expect(start_plan.interaction_of(OPTIONS, true).value).toBe('interactive')
	})

	it('runs unattended with --yes', () => {
		expect(start_plan.interaction_of({ ...OPTIONS, is_yes: true }, false).value).toBe('unattended')
	})

	it('stops without a terminal or --yes', () => {
		expect(start_plan.interaction_of(OPTIONS, false).refusal).toContain('Pass --yes')
	})
})

describe('consent to create the GitHub repository', () => {
	it('does not take --yes alone as consent to create or push', () => {
		const verdict = start_plan.github_consent(WITH_REPOSITORY, OPTIONS, 'unattended')

		expect(verdict.value).toBeUndefined()
		expect(verdict.refusal).toContain(ADD_GITHUB)
	})

	it('creates unattended only with --github', () => {
		const options = { ...OPTIONS, is_yes: true, is_github: true }

		expect(start_plan.github_consent(WITH_REPOSITORY, options, 'unattended').value).toBe('granted')
	})

	it('asks at a terminal when --github was not given', () => {
		expect(start_plan.github_consent(WITH_REPOSITORY, OPTIONS, 'interactive').value).toBe('ask')
	})

	it('needs no consent when no repository is created', () => {
		expect(start_plan.github_consent(['labels'], OPTIONS, 'unattended').value).toBe('granted')
	})

	it('does not take --yes alone as consent to open the setup pull request', () => {
		const verdict = start_plan.github_consent(['labels', 'setup_pr'], OPTIONS, 'unattended')

		expect(verdict.value).toBeUndefined()
		expect(verdict.refusal).toContain(ADD_GITHUB)
	})

	it('asks at a terminal before opening the setup pull request', () => {
		expect(start_plan.github_consent(['setup_pr'], OPTIONS, 'interactive').value).toBe('ask')
	})
})

describe('the progress report of a failed run', () => {
	it('names the failed step, the completed ones and the cause', () => {
		const report = start_plan.progress_report('repository', ['git_init', 'initialize'], 'boom')

		expect(report).toContain(`stopped at: ${start_plan.STEP_LABELS.repository}`)
		expect(report).toContain(`Completed: ${start_plan.STEP_LABELS.git_init};`)
		expect(report).toContain('Cause: boom')
	})

	it('says nothing was completed when the first step fails', () => {
		expect(start_plan.progress_report('git_init', [], 'boom')).toContain('Completed: nothing')
	})

	it('lists the plan in order before running it', () => {
		expect(start_plan.plan_summary(['initialize', 'labels'])).toBe(
			`josh start will:\n  1. ${start_plan.STEP_LABELS.initialize}\n  2. ${start_plan.STEP_LABELS.labels}`,
		)
	})
})
