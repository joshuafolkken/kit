import { repository_labels } from '#scripts/repo/repository-labels'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { init_dry_run } from './init-dry-run'
import type { ProjectShape } from './project-profile'
import { start_dry_run } from './start-dry-run'
import type { StartOptions, StartStep } from './start-plan'
import type { Choices } from './start-prompt'
import { workflow_mark } from './workflow-mark'

const SHAPE: ProjectShape = {
	profile: 'basic',
	reason: 'test',
	should_use_prettier: true,
	has_typescript: false,
	has_git: false,
	has_github: false,
	has_workflow: false,
}
const OPTIONS: StartOptions = {
	profile: undefined,
	is_yes: false,
	is_github: false,
	is_dry_run: true,
	visibility: 'private',
	init_command: undefined,
	push_preflight_command: undefined,
}
const ROOT = '/projects/app'
const SETUP_PLAN = 'setup plan'
const LABELS_STEP: StartStep = 'labels'

function choices(steps: ReadonlyArray<StartStep>, options: Partial<StartOptions> = {}): Choices {
	return {
		options: { ...OPTIONS, ...options },
		shape: SHAPE,
		consent: 'granted',
		root: ROOT,
		steps,
	}
}

beforeEach(() => {
	vi.restoreAllMocks()
	vi.spyOn(init_dry_run, 'plan_report').mockReturnValue(SETUP_PLAN)
	vi.spyOn(repository_labels, 'planned_labels').mockReturnValue(['bugfix', 'epic'])
	vi.spyOn(workflow_mark, 'request').mockImplementation(() => undefined)
})

describe('start_dry_run.report — GitHub (#3830)', () => {
	it('names the repository, the labels and the setup pull request it would create', () => {
		const report = start_dry_run.report(choices(['repository', LABELS_STEP, 'setup_pr']))

		expect(report).toContain('create the private repository app as origin, and push main')
		expect(report).toContain('add the labels it lacks: bugfix, epic')
		expect(report).toContain('open a pull request into main')
	})

	it('reads no labels for a repository the run would create, and the existing one otherwise', () => {
		start_dry_run.report(choices(['repository', LABELS_STEP]))
		start_dry_run.report(choices([LABELS_STEP]))

		expect(vi.mocked(repository_labels.planned_labels).mock.calls).toStrictEqual([
			[undefined],
			['{owner}/{repo}'],
		])
	})

	it('says the labels could not be read rather than naming none', () => {
		vi.mocked(repository_labels.planned_labels).mockReturnValue(undefined)

		expect(start_dry_run.report(choices([LABELS_STEP]))).toContain('could not be read')
	})

	it('says none when no step reaches GitHub', () => {
		expect(start_dry_run.report(choices([]))).toContain('GitHub:\n  (none)')
	})
})

describe('start_dry_run.report — the setup step (#3830)', () => {
	it('simulates kit’s own setup with the workflow mark and the repository it would have', () => {
		const report = start_dry_run.report(choices(['git_init', 'initialize']))

		expect(report).toContain(SETUP_PLAN)
		expect(workflow_mark.request).toHaveBeenCalled()
		expect(init_dry_run.plan_report).toHaveBeenCalledWith(
			{ root: ROOT, profile: 'basic', has_git: true, is_install: true },
			expect.any(String),
		)
	})

	it('names a caller’s setup command instead of simulating it', () => {
		const report = start_dry_run.report(choices(['initialize'], { init_command: 'app init' }))

		expect(report).toContain('would run app init --profile basic, which is not simulated')
		expect(init_dry_run.plan_report).not.toHaveBeenCalled()
	})

	it('adds no setup section when the setup step is not planned', () => {
		start_dry_run.report(choices([LABELS_STEP]))

		expect(init_dry_run.plan_report).not.toHaveBeenCalled()
	})
})
