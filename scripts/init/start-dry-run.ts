import path from 'node:path'
import { repository_labels } from '#scripts/repo/repository-labels'
import { init_dry_run } from './init-dry-run'
import type { ProjectProfile } from './project-profile'
import type { StartStep } from './start-plan'
import type { Choices } from './start-prompt'
import { start_setup_pr } from './start-setup-pr'
import { workflow_mark } from './workflow-mark'

// What `josh start --dry-run` adds to the plan `josh start` prints: what each GitHub step would
// create, and what its setup step would write. Nothing here creates, pushes or writes (#3830).

const TITLE = 'josh start --dry-run — nothing was written. Its setup step would:'
const NONE = '(none)'
const UNREAD_LABELS =
	'add the workflow labels it lacks — the repository’s labels could not be read to name them'

// The labels are read from the repository when it already exists — the same listing the real step
// compares against — and a repository this run would create has none.
function label_line(steps: ReadonlyArray<StartStep>): string {
	const repo = steps.includes('repository') ? undefined : '{owner}/{repo}'
	const labels = repository_labels.planned_labels(repo)

	if (labels === undefined) return UNREAD_LABELS

	return `add the labels it lacks: ${labels.length === 0 ? NONE : labels.join(', ')}`
}

function github_lines({ steps, root, options }: Choices): Array<string> {
	const lines: Readonly<Partial<Record<StartStep, string | undefined>>> = {
		repository: `create the ${options.visibility} repository ${path.basename(root)} as origin, and push main`,
		labels: steps.includes('labels') ? label_line(steps) : undefined,
		setup_pr: `open the Issue "${start_setup_pr.SETUP_TITLE}" (or reuse the open one), push a branch named after it, and open a pull request into main`,
	}

	return steps.map((step) => lines[step]).filter((line) => line !== undefined)
}

function github_report(choices: Choices): string {
	const lines = github_lines(choices).map((line) => `  ${line}`)

	return ['GitHub:', ...(lines.length === 0 ? [`  ${NONE}`] : lines)].join('\n')
}

// A caller's setup command writes files kit cannot name, so it is named rather than simulated. Kit's
// own setup runs on a scratch copy, told it sets up the GitHub workflow as the real step tells it,
// with the repository the run would have created by then.
function setup_report({ steps, root, options, shape }: Choices): string | undefined {
	if (!steps.includes('initialize')) return undefined
	const profile: ProjectProfile = options.profile ?? shape.profile

	if (options.init_command !== undefined) {
		return `The setup step would run ${options.init_command} --profile ${profile}, which is not simulated.`
	}

	workflow_mark.request()
	const has_git = shape.has_git || steps.includes('git_init')

	return init_dry_run.plan_report({ root, profile, has_git, is_install: true }, TITLE)
}

function report(choices: Choices): string {
	const setup = setup_report(choices)
	const sections = [github_report(choices), ...(setup === undefined ? [] : [setup])]

	return `\n${sections.join('\n\n')}`
}

const start_dry_run = { report }
export { start_dry_run }
