import type { ProjectProfile } from './project-profile'

type Visibility = 'private' | 'public'

interface StartOptions {
	profile: ProjectProfile | undefined
	is_yes: boolean
	is_github: boolean
	visibility: Visibility
}

type StartStep = 'git_init' | 'initialize' | 'commit' | 'repository' | 'labels'

interface GitState {
	has_git: boolean
	has_github: boolean
	has_origin: boolean
	branch: string | undefined
	has_commits: boolean
}

interface StepPlan {
	steps: ReadonlyArray<StartStep>
	refusal: string | undefined
}

type Interaction = 'interactive' | 'unattended'
type Consent = 'granted' | 'ask'

interface Verdict<T> {
	value: T | undefined
	refusal: string | undefined
}

const DEFAULT_BRANCH = 'main'
const FULL_STEPS: ReadonlyArray<StartStep> = [
	'git_init',
	'initialize',
	'commit',
	'repository',
	'labels',
]

const STEP_LABELS: Readonly<Record<StartStep, string>> = {
	git_init: 'Create a Git repository on main',
	initialize: 'Initialize kit (the same setup as josh init)',
	commit: 'Commit every file as the initial commit',
	repository: 'Create the GitHub repository and push main',
	labels: 'Add the workflow and release-classification labels the repository is missing',
}

function refused(refusal: string): StepPlan {
	return { steps: [], refusal }
}

// A repository that already has a history keeps it: nothing is committed on the user's behalf, and
// only `main` is pushed, because the Issue workflow branches from and merges into it.
function existing_git_steps(state: GitState): StepPlan {
	if (!state.has_commits) return { steps: FULL_STEPS.slice(1), refusal: undefined }

	if (state.branch !== DEFAULT_BRANCH) {
		return refused(
			`josh start pushes ${DEFAULT_BRANCH}, but this repository is on ${state.branch ?? 'a detached HEAD'}. Switch to ${DEFAULT_BRANCH}, or run josh init to set up without GitHub.`,
		)
	}

	return { steps: ['initialize', 'repository', 'labels'], refusal: undefined }
}

// An existing GitHub origin is never replaced or pushed to: only the additive steps run. Any other
// origin is refused here, before the first write — `gh repo create --remote origin` cannot add a
// remote that already exists, so the run would otherwise fail after initializing the directory.
function plan_steps(state: GitState): StepPlan {
	if (state.has_github) return { steps: ['initialize', 'labels'], refusal: undefined }

	if (state.has_origin) {
		return refused(
			'josh start creates the GitHub repository as origin, but this repository already has an origin that is not on GitHub. Remove or rename it, or run josh init to set up without GitHub.',
		)
	}

	if (state.has_git) return existing_git_steps(state)

	return { steps: FULL_STEPS, refusal: undefined }
}

function interaction_of(options: StartOptions, is_tty: boolean): Verdict<Interaction> {
	if (options.is_yes) return { value: 'unattended', refusal: undefined }
	if (is_tty) return { value: 'interactive', refusal: undefined }

	return {
		value: undefined,
		refusal:
			'josh start needs a terminal to confirm its choices. Pass --yes to accept the detected profile, and --github to create the GitHub repository.',
	}
}

// `--yes` accepts the detected defaults, never the creation of a public-facing resource: an
// unattended run creates and pushes a repository only when `--github` asks for it by name.
function github_consent(
	steps: ReadonlyArray<StartStep>,
	options: StartOptions,
	interaction: Interaction,
): Verdict<Consent> {
	if (!steps.includes('repository') || options.is_github) {
		return { value: 'granted', refusal: undefined }
	}

	if (interaction === 'interactive') return { value: 'ask', refusal: undefined }

	return {
		value: undefined,
		refusal:
			'josh start --yes does not create a GitHub repository or push. Add --github to create one, or run josh init to set up without GitHub.',
	}
}

// What a failed run prints, so the user can tell how far it got before deciding how to resume.
function progress_report(
	failed: StartStep,
	completed: ReadonlyArray<StartStep>,
	cause: string,
): string {
	const done =
		completed.length === 0 ? 'nothing' : completed.map((step) => STEP_LABELS[step]).join('; ')

	return `josh start stopped at: ${STEP_LABELS[failed]}\nCompleted: ${done}\nCause: ${cause}`
}

function plan_summary(steps: ReadonlyArray<StartStep>): string {
	const lines = steps.map((step, index) => `  ${String(index + 1)}. ${STEP_LABELS[step]}`)

	return ['josh start will:', ...lines].join('\n')
}

const start_plan = {
	plan_steps,
	interaction_of,
	github_consent,
	progress_report,
	plan_summary,
	STEP_LABELS,
}
export { start_plan }
export type { Consent, GitState, Interaction, StartOptions, StartStep, StepPlan, Visibility }
