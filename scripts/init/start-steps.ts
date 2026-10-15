import path from 'node:path'
import { git_spawn_sync } from '#scripts/git/git-spawn-sync'
import { error_text } from '#scripts/lib/error-message'
import { repository_labels } from '#scripts/repo/repository-labels'
import { security_audit } from '#scripts/security/security-audit'
import { security_audit_provision } from '#scripts/security/security-audit-provision'
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
import { workflow_mark } from './workflow-mark'

interface StepContext {
	root: string
	profile: ProjectProfile
	visibility: Visibility
	init_command: string | undefined
	push_preflight_command: string | undefined
}

interface RunContext extends StepContext {
	baseline: ReadonlyArray<string> | undefined
}

const GH_INSTALL_HINT =
	'GitHub CLI (gh) is not installed. Install it from https://cli.github.com/, run gh auth login, then run josh start again. Nothing was changed.'
const GH_AUTH_HINT =
	'GitHub CLI is not signed in. Run gh auth login, then run josh start again. Nothing was changed.'
const GIT_IDENTITY_HINT =
	'Git has no author identity, which the commit josh start creates needs. Run git config --global user.name "Your Name" and git config --global user.email "you@example.com", then run josh start again. Nothing was changed.'
// Printed before the scanner is looked for: a first run downloads tens of megabytes, and a terminal
// that says nothing for minutes reads as a hang the user interrupts (#3755).
const SCANNER_NOTICE =
	'Checking for osv-scanner, which the pre-push audit needs. A first run downloads it, which can take a few minutes on a slow connection.'

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

// A machine Git was just installed on has no author identity, and the commit that needs one comes
// after the repository and kit's files are written. It is asked for before the first write, and only
// when the plan commits — a re-run with nothing left to commit is not stopped by it (#3754).
function git_identity_refusal(steps: ReadonlyArray<StartStep>, root: string): string | undefined {
	if (!start_plan.has_commit(steps)) return undefined

	return start_exec.lacks_git_identity(root, steps.includes('git_init'))
		? GIT_IDENTITY_HINT
		: undefined
}

// `josh init` refuses to run inside the kit source repository by printing and setting the exit code
// rather than throwing, so its step would pass and the later steps would commit and publish the
// source repository. The same check is raised before the first write instead.
function self_run_refusal(root: string): string | undefined {
	return self_sync_guard.self_sync_refusal(PACKAGE_DIR, root)
}

// A caller's command line runs without a shell, split the way execa splits one.
function run_command_line(command_line: string, extra: ReadonlyArray<string>, root: string): void {
	const [command = '', ...args] = parseCommandString(command_line)

	run_local(command, [...args, ...extra], root)
}

function create_git_repository(context: StepContext): void {
	initial_commit.create_repository(context.root)
}

// The same setup `josh init` runs, called rather than copied, with the profile the user confirmed.
// A toolkit that layers its files over kit's (`josh-app init`) names its own setup instead, so every
// other step and guard stays here rather than in a copy of this command (#2872). That command runs
// without a shell, is given the same profile, and a non-zero exit stops the run before the commit.
// Either one is told the project is set up for the GitHub Issue workflow (`workflow-mark.ts`).
function initialize(context: StepContext): void {
	workflow_mark.request()

	if (context.init_command === undefined) {
		init_main(['--profile', context.profile])

		return
	}

	run_command_line(context.init_command, ['--profile', context.profile], context.root)
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

// A toolkit's own pre-push hook can need something kit knows nothing about (app-kit's needs a Docker
// daemon), and a push it refuses lands after `gh repo create` has made the repository. So the caller
// names a check that runs only when the plan pushes, before the first step: a run that does not push
// is never stopped by it, and one it stops has written nothing (#3702).
function run_push_preflight(steps: ReadonlyArray<StartStep>, context: StepContext): void {
	const command_line = context.push_preflight_command

	if (command_line === undefined || !start_plan.has_push(steps)) return

	console.info(`\nPush preflight: ${command_line}`)

	try {
		run_command_line(command_line, [], context.root)
	} catch (error) {
		const cause = error_text.message_of(error)

		throw new Error(start_plan.preflight_report(command_line, cause), { cause: error })
	}
}

// The `full` profile installs kit's pre-push hook, whose audit refuses a push without osv-scanner. The
// scanner is otherwise fetched at an agent's session start, which a first `josh start` from a terminal
// has not had, so it is fetched here — forced, because a person asked for this run. A scanner that
// still cannot be found stops the run before the first step rather than at the push (#3755).
async function ensure_audit_scanner(
	steps: ReadonlyArray<StartStep>,
	context: StepContext,
): Promise<void> {
	if (context.profile !== 'full' || !start_plan.has_push(steps)) return

	const { platform, arch } = process

	console.info(`\n${SCANNER_NOTICE}`)
	const outcome = await security_audit_provision.report(context.root, platform, arch, true)

	console.info(outcome)
	if (security_audit.resolve_scanner(context.root, platform) !== undefined) return

	throw new Error(start_plan.scanner_report(outcome))
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

	run_push_preflight(steps, context)
	await ensure_audit_scanner(steps, context)
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
	git_identity_refusal,
	self_run_refusal,
	run_steps,
}
export { start_steps }
export type { StepContext }
