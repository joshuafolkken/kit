import type { ProjectProfile } from './project-profile'
import { start_setup_pr } from './start-setup-pr'

type Visibility = 'private' | 'public'

interface StartOptions {
	profile: ProjectProfile | undefined
	is_yes: boolean
	is_github: boolean
	visibility: Visibility
	init_command: string | undefined
}

type StartStep = 'git_init' | 'initialize' | 'commit' | 'repository' | 'labels' | 'setup_pr'

interface GitState {
	has_git: boolean
	has_github: boolean
	has_origin: boolean
	branch: string | undefined
	has_commits: boolean
	has_kit_committed: boolean
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
	setup_pr: 'Open an Issue and a pull request that add the kit setup to main',
}

// The GitHub write steps `--yes` alone never consents to.
const GITHUB_WRITE_STEPS: ReadonlySet<StartStep> = new Set(['repository', 'setup_pr'])

function refused(refusal: string): StepPlan {
	return { steps: [], refusal }
}

// Main already has a history but not kit's setup, so the setup reaches main the way every later change
// does — an Issue and a pull request a person merges — rather than a commit on main.
// On another branch the pull request would not be based on main, so it waits
// — except the setup branch a failed hook left checked out, where a re-run resumes. Once kit is
// committed there, nothing is left for the step, so a later run on that branch plans none.
function needs_setup_pr(state: GitState): boolean {
	if (!state.has_commits || state.has_kit_committed) return false

	return state.branch === DEFAULT_BRANCH || start_setup_pr.is_setup_branch(state.branch)
}

function with_setup_pr(steps: ReadonlyArray<StartStep>, state: GitState): StepPlan {
	return { steps: needs_setup_pr(state) ? [...steps, 'setup_pr'] : steps, refusal: undefined }
}

// A repository that already has a history keeps it: nothing is committed on main on the user's
// behalf, and only `main` is pushed, because the Issue workflow branches from and merges into it.
function existing_git_steps(state: GitState): StepPlan {
	if (!state.has_commits) return { steps: FULL_STEPS.slice(1), refusal: undefined }

	if (state.branch !== DEFAULT_BRANCH) {
		return refused(
			`josh start pushes ${DEFAULT_BRANCH}, but this repository is on ${state.branch ?? 'a detached HEAD'}. Switch to ${DEFAULT_BRANCH}, or run josh init to set up without GitHub.`,
		)
	}

	return with_setup_pr(['initialize', 'repository', 'labels'], state)
}

// An existing GitHub origin is never replaced, and main is never pushed to: only the additive steps
// run, plus the setup pull request while main lacks kit. Any other origin is refused here, before the
// first write — `gh repo create --remote origin` cannot add a remote that already exists, so the run
// would otherwise fail after initializing the directory.
function plan_steps(state: GitState): StepPlan {
	if (state.has_github) return with_setup_pr(['initialize', 'labels'], state)

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
// unattended run creates a repository, pushes, or opens the setup Issue and pull request only when
// `--github` asks for it by name.
function github_consent(
	steps: ReadonlyArray<StartStep>,
	options: StartOptions,
	interaction: Interaction,
): Verdict<Consent> {
	const is_github_write = steps.some((step) => GITHUB_WRITE_STEPS.has(step))

	if (!is_github_write || options.is_github) return { value: 'granted', refusal: undefined }
	if (interaction === 'interactive') return { value: 'ask', refusal: undefined }

	return {
		value: undefined,
		refusal:
			'josh start --yes does not write to GitHub (create a repository, push, or open the setup pull request). Add --github to allow it, or run josh init to set up without GitHub.',
	}
}

// A run whose initialize step was handed to a caller's command names that command wherever the step
// is printed, so the plan, the progress and a failure all say what actually runs (#2872).
function step_labels(init_command: string | undefined): Readonly<Record<StartStep, string>> {
	if (init_command === undefined) return STEP_LABELS

	return { ...STEP_LABELS, initialize: `Initialize with ${init_command}` }
}

// What a failed run prints, so the user can tell how far it got before deciding how to resume.
function progress_report(
	failed: StartStep,
	completed: ReadonlyArray<StartStep>,
	cause: string,
	labels: Readonly<Record<StartStep, string>> = STEP_LABELS,
): string {
	const done = completed.length === 0 ? 'nothing' : completed.map((step) => labels[step]).join('; ')

	return `josh start stopped at: ${labels[failed]}\nCompleted: ${done}\nCause: ${cause}`
}

function plan_summary(
	steps: ReadonlyArray<StartStep>,
	labels: Readonly<Record<StartStep, string>> = STEP_LABELS,
): string {
	const lines = steps.map((step, index) => `  ${String(index + 1)}. ${labels[step]}`)

	return ['josh start will:', ...lines].join('\n')
}

const start_plan = {
	plan_steps,
	interaction_of,
	github_consent,
	progress_report,
	plan_summary,
	step_labels,
	STEP_LABELS,
}
export { start_plan }
export type { Consent, GitState, Interaction, StartOptions, StartStep, StepPlan, Visibility }
