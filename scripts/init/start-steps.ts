import path from 'node:path'
import { git_spawn_sync } from '#scripts/git/git-spawn-sync'
import { error_text } from '#scripts/lib/error-message'
import { repository_labels } from '#scripts/repo/repository-labels'
import { self_sync_guard } from '#scripts/self-sync-guard/self-sync-guard-logic'
import { parseCommandString } from 'execa'
import { main as init_main } from './init'
import { PACKAGE_DIR } from './init-paths'
import { initial_commit } from './initial-commit'
import { kit_setup_state } from './kit-setup-state'
import type { ProjectProfile, ProjectShape } from './project-profile'
import { start_exec } from './start-exec'
import { start_plan, type GitState, type StartStep, type Visibility } from './start-plan'
import { start_setup_pr } from './start-setup-pr'

interface StepContext {
	root: string
	profile: ProjectProfile
	visibility: Visibility
	init_command: string | undefined
}

interface RunContext extends StepContext {
	baseline: ReadonlyArray<string> | undefined
}

const GH_INSTALL_HINT =
	'GitHub CLI (gh) is not installed. Install it from https://cli.github.com/, run gh auth login, then run josh start again. Nothing was changed.'
const GH_AUTH_HINT =
	'GitHub CLI is not signed in. Run gh auth login, then run josh start again. Nothing was changed.'

const { git_succeeds, git_read, run_local } = start_exec

function read_git_state(root: string, shape: ProjectShape): GitState {
	const { has_git, has_github } = shape

	if (!has_git) {
		return {
			has_git,
			has_github,
			has_origin: false,
			branch: undefined,
			has_commits: false,
			has_kit_committed: false,
		}
	}

	const has_origin = git_spawn_sync.origin_url(root) !== undefined
	const branch = git_read(['symbolic-ref', '--short', 'HEAD'], root)
	const has_commits = git_succeeds(['rev-parse', '--verify', '--quiet', 'HEAD'], root)
	const has_kit_committed = kit_setup_state.is_kit_committed(root)

	return { has_git, has_github, has_origin, branch, has_commits, has_kit_committed }
}

// Every step talks to GitHub, so the CLI is checked before the first write rather than at the step
// that needs it — a missing `gh` then leaves the directory exactly as it was.
function github_cli_refusal(root: string): string | undefined {
	if (!start_exec.is_gh_installed(root)) return GH_INSTALL_HINT
	if (!start_exec.is_gh_signed_in(root)) return GH_AUTH_HINT

	return undefined
}

// `josh init` refuses to run inside the kit source repository by printing and setting the exit code
// rather than throwing, so its step would pass and the later steps would commit and publish the
// source repository. The same check is raised before the first write instead.
function self_run_refusal(root: string): string | undefined {
	return self_sync_guard.self_sync_refusal(PACKAGE_DIR, root)
}

function create_git_repository(context: StepContext): void {
	initial_commit.create_repository(context.root)
}

// The same setup `josh init` runs, called rather than copied, with the profile the user confirmed.
// A toolkit that layers its files over kit's (`josh-app init`) names its own setup instead, so every
// other step and guard stays here rather than in a copy of this command (#2872). That command runs
// without a shell, is given the same profile, and a non-zero exit stops the run before the commit.
function initialize(context: StepContext): void {
	if (context.init_command === undefined) {
		init_main(['--profile', context.profile])

		return
	}

	const [command = '', ...args] = parseCommandString(context.init_command)

	run_local(command, [...args, '--profile', context.profile], context.root)
}

function commit_all(context: StepContext): void {
	initial_commit.commit_all(context.root)
}

function create_github_repository(context: StepContext): void {
	start_exec.create_github_repository(path.basename(context.root), context.visibility, context.root)
}

// The repository was created by the step before, so `gh` resolves the placeholder from the
// directory `josh start` runs in, which is the root.
function add_missing_labels(): void {
	repository_labels.ensure_labels('{owner}/{repo}')
}

// Main already has a history here, so the setup reaches it the way every other change does: through
// an Issue and a pull request a person merges.
async function open_setup_pull_request(context: RunContext): Promise<void> {
	await start_setup_pr.open(context.root, context.baseline)
}

// What was already changed before the setup ran, read whenever a setup pull request will follow, so
// it can tell the setup's files from the user's own (#2872). Kit's own `josh init` needs it as much as
// a caller's command: its `josh format` rewrites the project's own sources, which kit cannot name, and
// leaving them out failed the pull request's Prettier check.
function baseline_of(
	steps: ReadonlyArray<StartStep>,
	context: StepContext,
): ReadonlyArray<string> | undefined {
	if (!steps.includes('setup_pr')) return undefined

	return start_setup_pr.changed_paths(context.root)
}

type StepAction = (context: RunContext) => void | Promise<void>

const STEP_ACTIONS: Readonly<Record<StartStep, StepAction>> = {
	git_init: create_git_repository,
	initialize,
	commit: commit_all,
	repository: create_github_repository,
	labels: add_missing_labels,
	setup_pr: open_setup_pull_request,
}

async function run_step(
	step: StartStep,
	context: RunContext,
	completed: ReadonlyArray<StartStep>,
): Promise<void> {
	try {
		await STEP_ACTIONS[step](context)
	} catch (error) {
		const cause = error_text.message_of(error)
		const labels = start_plan.step_labels(context.init_command)

		throw new Error(start_plan.progress_report(step, completed, cause, labels), { cause: error })
	}
}

async function run_steps(steps: ReadonlyArray<StartStep>, context: StepContext): Promise<void> {
	const labels = start_plan.step_labels(context.init_command)
	const run_context: RunContext = { ...context, baseline: baseline_of(steps, context) }

	for (const [index, step] of steps.entries()) {
		const position = `${String(index + 1)}/${String(steps.length)}`

		console.info(`\n[${position}] ${labels[step]}`)
		// eslint-disable-next-line no-await-in-loop -- each step builds on what the earlier ones set up
		await run_step(step, run_context, steps.slice(0, index))
	}
}

const start_steps = {
	read_git_state,
	github_cli_refusal,
	self_run_refusal,
	run_steps,
}
export { start_steps }
export type { StepContext }
