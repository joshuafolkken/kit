import path from 'node:path'
import { git_gh_exec } from '#scripts/git/git-gh-exec'
import { repository_labels } from '#scripts/repo/repository-labels'
import { self_sync_guard } from '#scripts/self-sync-guard/self-sync-guard-logic'
import { execaSync } from 'execa'
import { main as init_main } from './init'
import { PACKAGE_DIR } from './init-paths'
import type { ProjectProfile, ProjectShape } from './project-profile'
import { start_plan, type GitState, type StartStep, type Visibility } from './start-plan'

interface StepContext {
	root: string
	profile: ProjectProfile
	visibility: Visibility
}

const DEFAULT_BRANCH = 'main'
const GH_INSTALL_HINT =
	'GitHub CLI (gh) is not installed. Install it from https://cli.github.com/, run gh auth login, then run josh start again. Nothing was changed.'
const GH_AUTH_HINT =
	'GitHub CLI is not signed in. Run gh auth login, then run josh start again. Nothing was changed.'

function succeeds(command: string, args: ReadonlyArray<string>, root: string): boolean {
	return execaSync(command, args, { cwd: root, reject: false }).exitCode === 0
}

function read_output(
	command: string,
	args: ReadonlyArray<string>,
	root: string,
): string | undefined {
	const result = execaSync(command, args, { cwd: root, reject: false })

	return result.exitCode === 0 ? result.stdout.trim() : undefined
}

// Every step spawned here dials GitHub directly, past a scanner's loopback proxy, the same as every
// other `gh` spawn under scripts/ (joshuafolkken/kit#2436); a local `git` step is unaffected by it.
function run(command: string, args: ReadonlyArray<string>, root: string): void {
	execaSync(command, args, { ...git_gh_exec.direct_environment(), cwd: root, stdio: 'inherit' })
}

function read_git_state(root: string, shape: ProjectShape): GitState {
	const { has_git, has_github } = shape

	if (!has_git) {
		return { has_git, has_github, has_origin: false, branch: undefined, has_commits: false }
	}

	const has_origin = succeeds('git', ['remote', 'get-url', 'origin'], root)
	const branch = read_output('git', ['symbolic-ref', '--short', 'HEAD'], root)
	const has_commits = succeeds('git', ['rev-parse', '--verify', '--quiet', 'HEAD'], root)

	return { has_git, has_github, has_origin, branch, has_commits }
}

// Every step talks to GitHub, so the CLI is checked before the first write rather than at the step
// that needs it — a missing `gh` then leaves the directory exactly as it was.
function github_cli_refusal(root: string): string | undefined {
	if (!succeeds('gh', ['--version'], root)) return GH_INSTALL_HINT
	if (!succeeds('gh', ['auth', 'status'], root)) return GH_AUTH_HINT

	return undefined
}

// `josh init` refuses to run inside the kit source repository by printing and setting the exit code
// rather than throwing, so its step would pass and the later steps would commit and publish the
// source repository. The same check is raised before the first write instead.
function self_run_refusal(root: string): string | undefined {
	return self_sync_guard.self_sync_refusal(PACKAGE_DIR, root)
}

function create_git_repository(context: StepContext): void {
	run('git', ['init', `--initial-branch=${DEFAULT_BRANCH}`], context.root)
}

// The same setup `josh init` runs, called rather than copied, with the profile the user confirmed.
function initialize(context: StepContext): void {
	init_main(['--profile', context.profile])
}

function commit_all(context: StepContext): void {
	run('git', ['add', '--all'], context.root)
	// The first commit of a new repository has no branch to come from, so the hook that keeps commits
	// off main — installed by the initialize step in a full project — would refuse the only commit
	// that has to land there.
	run('git', ['commit', '--no-verify', '--message', 'Initial commit'], context.root)
	// A repository created by an older `git init` may name its unborn branch `master`.
	run('git', ['branch', '--move', '--force', DEFAULT_BRANCH], context.root)
}

function create_github_repository(context: StepContext): void {
	const name = path.basename(context.root)
	const visibility = `--${context.visibility}`
	const source = ['--source', '.', '--remote', 'origin', '--push']

	run('gh', ['repo', 'create', name, visibility, ...source], context.root)
}

// The repository was created by the step before, so `gh` resolves the placeholder from the
// directory `josh start` runs in, which is the root.
function add_missing_labels(): void {
	repository_labels.ensure_labels('{owner}/{repo}')
}

const STEP_ACTIONS: Readonly<Record<StartStep, (context: StepContext) => void>> = {
	git_init: create_git_repository,
	initialize,
	commit: commit_all,
	repository: create_github_repository,
	labels: add_missing_labels,
}

function run_step(
	step: StartStep,
	context: StepContext,
	completed: ReadonlyArray<StartStep>,
): void {
	try {
		STEP_ACTIONS[step](context)
	} catch (error) {
		const cause = error instanceof Error ? error.message : String(error)

		throw new Error(start_plan.progress_report(step, completed, cause), { cause: error })
	}
}

function run_steps(steps: ReadonlyArray<StartStep>, context: StepContext): void {
	for (const [index, step] of steps.entries()) {
		const position = `${String(index + 1)}/${String(steps.length)}`

		console.info(`\n[${position}] ${start_plan.STEP_LABELS[step]}`)
		run_step(step, context, steps.slice(0, index))
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
