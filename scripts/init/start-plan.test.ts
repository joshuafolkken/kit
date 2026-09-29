import { describe, expect, it } from 'vitest'
import { start_plan, type GitState, type StartOptions } from './start-plan'

const NO_GIT: GitState = {
	has_git: false,
	has_github: false,
	branch: undefined,
	has_commits: false,
}
const OPTIONS: StartOptions = {
	profile: undefined,
	is_yes: false,
	is_github: false,
	visibility: 'private',
}
const WITH_REPOSITORY = ['initialize', 'repository'] as const

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
		const state = { ...NO_GIT, has_git: true, branch: 'main', has_commits: true }

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
		expect(verdict.refusal).toContain('Add --github')
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
