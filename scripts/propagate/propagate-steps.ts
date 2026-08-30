import { git_gh_exec } from '#scripts/git/git-gh-exec'
import { git_gh_issue_write } from '#scripts/git/git-gh-issue-write'
import { GATE_COMMAND } from '#scripts/josh/josh-command-types'
import { build_upgrade_shell_command } from '#scripts/version/upgrade-shell-command'
import { create_version_command_config } from '#scripts/version/version-command-config'
import { execaSync } from 'execa'
import { propagate_git } from './propagate-git'
import { propagate_run, type RunStep, type StepResult } from './propagate-run'
import type { PropagateTarget } from './propagate-targets'

// Executing one consumer's steps for real.
//
// Kept out of the command module because two of the steps are not plain spawns: the pre-check is a
// decision made from git probes, and the pull-request step needs the issue number the step before it
// created. A closure carries that number instead of module-level state, so a run is self-contained
// and the sequencing stays testable (joshuafolkken/kit#863).

const SUCCESS_EXIT_CODE = 0
// Long enough for a consumer's full unit suite and a `pnpm add`, short enough that a hung step ends
// the run instead of holding the whole propagation open.
const STEP_TIMEOUT_MS = 1_800_000
// The consumer-side gate. `josh gate` is the same command the AI documents require of a person
// (joshuafolkken/kit#914) — running the four checks concurrently and reporting every failure in one
// pass — so the chain is not repeated here. It resolves in the consumer's directory, which by this
// point has already been upgraded to the version being propagated, so the command is present.
const VERIFY_SCRIPT = `pnpm josh ${GATE_COMMAND}`

// The commands each spawning step runs inside the consumer's own directory. `pnpm josh` resolves the
// consumer's installed CLI, never the supplier's checkout — which is what keeps the sync a
// consumer-side sync and leaves kit's self-sync guard (joshuafolkken/kit#868) satisfied.
const STEP_COMMANDS: Readonly<Record<string, ReadonlyArray<string>>> = {
	[propagate_run.STEP_SYNC]: ['pnpm', 'josh', 'sync'],
	[propagate_run.STEP_VERIFY]: ['sh', '-c', VERIFY_SCRIPT],
}

// The upgrade installs the **exact** version that was waited for, not the registry's latest.
// `josh version:upgrade` resolves latest, which would defeat the exact-version wait: a release
// published while the run was in flight would be the one every consumer received. Built through
// kit's own upgrade-command builder so the lockfile repair it chains stays single-sourced.
function upgrade_command(package_name: string, version: string): ReadonlyArray<string> {
	const config = create_version_command_config({ package_name })

	return ['sh', '-c', build_upgrade_shell_command(version, true, config)]
}

function issue_title(package_name: string, version: string): string {
	return `Upgrade ${package_name} to ${version}`
}

function issue_body(package_name: string, version: string): string {
	return [
		`Carry \`${package_name}@${version}\` into this repository.`,
		'',
		'Opened by `josh propagate` from the supplier repository after the release was published.',
		'The upgrade, the managed-file sync and the verification gate have already run here.',
	].join('\n')
}

// Run a command in the consumer's directory, with its output inherited so a failing step shows why
// it failed. Discarding it would leave the report saying only `exit 1`.
function spawn_step(
	target: PropagateTarget,
	step: string,
	command: ReadonlyArray<string>,
): StepResult {
	const [executable, ...rest] = command
	if (executable === undefined) return { step, is_ok: false, detail: 'no command defined' }
	const result = execaSync(executable, rest, {
		cwd: target.path,
		reject: false,
		stdio: 'inherit',
		timeout: STEP_TIMEOUT_MS,
	})

	if (result.exitCode === SUCCESS_EXIT_CODE) return { step, is_ok: true }

	return { step, is_ok: false, detail: `exit ${String(result.exitCode ?? 'timed out')}` }
}

// Refuse a consumer whose working tree is not clean, is not on its default branch, or is behind its
// remote. Everything after this step commits and pushes, and `josh git` stages the whole tree — so a
// consumer's unrelated work in progress would otherwise ride into the pull request.
function precheck_step(target: PropagateTarget, step: string): StepResult {
	const state = propagate_git.tree_state(target.path)
	if (state.is_ready) return { step, is_ok: true }

	return { step, is_ok: false, detail: state.reason ?? 'not ready' }
}

// Open the issue the pull request will close. `josh git` requires an issue argument — it derives the
// branch name and the `closes #N` line from it — so the upgrade gets a tracked issue in the consumer
// rather than a branchless pull request that cannot be opened at all.
//
// It posts to REST instead of running `gh issue create`: that command goes through GraphQL, which a
// cloud session is answered 403 for, while the REST endpoint is served normally
// (joshuafolkken/kit#1022). This was the last `gh <noun> <verb>` spawn in kit's own code, and it was
// missed by that epic's survey because the survey counted `exec_gh_command` call sites and this one
// spawned gh directly (joshuafolkken/kit#1042).
//
// The request is the one every issue creation builds, and the spawn is the synchronous twin of the
// one the asynchronous writers use — so no second write layer exists to disagree with the first.
// Two things follow from the switch: the multi-line body travels over stdin rather than as an
// argument, and the path names the consumer repository outright, so the call no longer depends on
// the directory it is spawned in.
// gh's own output is the only thing that distinguishes a missing scope from disabled issues from a
// repository that does not exist. Reporting `could not open an issue` alone hides all three, so the
// whole message is kept — `to_gh_error` puts the stderr summary and the JSON body REST writes to
// stdout on separate lines (joshuafolkken/kit#1029), and both carry the reason.
//
// **It is folded back onto one line here.** The run's report is one line per consumer, and
// `failure_reason` appends the "changes left uncommitted" warning to the end of this text — so a
// multi-line detail would print raw JSON as an unindented second line and glue that warning to the
// end of it, where nobody reading the report would see it.
function to_issue_detail(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error)

	return message.replaceAll('\n', ' ').trim()
}

function open_issue(target: PropagateTarget, package_name: string, version: string): IssueOutcome {
	try {
		const url = git_gh_exec.exec_gh_api_sync(
			git_gh_issue_write.issue_create_request({
				title: issue_title(package_name, version),
				body: issue_body(package_name, version),
				repo: target.repo,
			}),
		)

		return { url }
	} catch (error) {
		return { detail: to_issue_detail(error) }
	}
}

// What the creation produced: the new issue's URL, or gh's reason for refusing.
interface IssueOutcome {
	url?: string
	detail?: string
}

const ISSUE_NUMBER_PATTERN = /\/(?<number>\d+)\s*$/u

// The creation answers the new issue's browser URL — `.html_url`, which is the value `gh issue
// create` used to print — and its last path segment is the number `josh git` needs.
function parse_issue_number(issue_url: string): string | undefined {
	const { groups } = ISSUE_NUMBER_PATTERN.exec(issue_url.trim()) ?? {}
	const { number: issue_number } = groups ?? {}

	return issue_number
}

// The issue step: open it, and remember its number for the pull-request step.
function issue_step(
	target: PropagateTarget,
	step: string,
	release: Release,
	issue_numbers: Map<string, string>,
): StepResult {
	// Nothing changed, so there is nothing to open an issue about. Reached when the upgrade installed
	// a version the consumer already had and the sync rewrote no file; opening an issue and then
	// failing on an empty commit is the alternative.
	if (propagate_git.is_clean(target.path)) {
		return { step, is_ok: true, is_complete: true, detail: 'already current — nothing to commit' }
	}

	const outcome = open_issue(target, release.package_name, release.version)
	const number = parse_issue_number(outcome.url ?? '')

	if (number === undefined) {
		return { step, is_ok: false, detail: outcome.detail ?? 'could not open an issue' }
	}

	issue_numbers.set(target.repo, number)

	return { step, is_ok: true }
}

// Put the consumer back on its default branch. `josh git` leaves it on the feature branch, and the
// next run's pre-check would refuse it for that — the consumer would silently stop receiving
// releases (joshuafolkken/kit#863).
function return_step(target: PropagateTarget, step: string): StepResult {
	if (propagate_git.return_to_default_branch(target.path)) return { step, is_ok: true }

	return { step, is_ok: false, detail: 'left on the pull request branch' }
}

// The pull-request step, named after the issue the step before it opened.
function pull_request_step(
	target: PropagateTarget,
	step: string,
	release: Release,
	issue_numbers: ReadonlyMap<string, string>,
): StepResult {
	const number = issue_numbers.get(target.repo)
	if (number === undefined) return { step, is_ok: false, detail: 'no issue number' }
	const argument = `${issue_title(release.package_name, release.version)} #${number}`

	return spawn_step(target, step, ['pnpm', 'josh', 'git', '-y', argument])
}

// The release being carried, as one value so the step handlers stay within the parameter limit.
interface Release {
	package_name: string
	version: string
}

// A step runner bound to one propagation run. The issue number created for a consumer is kept here
// so the pull-request step can name it, without any module-level state to leak between runs.
function create_step_runner(release: Release): RunStep {
	const issue_numbers = new Map<string, string>()
	const handlers: Record<string, (target: PropagateTarget, step: string) => StepResult> = {
		[propagate_run.STEP_PRECHECK]: precheck_step,
		[propagate_run.STEP_ISSUE]: (target, step) => issue_step(target, step, release, issue_numbers),
		[propagate_run.STEP_PR]: (target, step) =>
			pull_request_step(target, step, release, issue_numbers),
		[propagate_run.STEP_RETURN]: return_step,
	}

	return (target: PropagateTarget, step: string): StepResult => {
		console.info(`  ${target.repo}: ${step}`)
		const handler = handlers[step]

		if (handler !== undefined) return handler(target, step)

		if (step === propagate_run.STEP_UPGRADE) {
			return spawn_step(target, step, upgrade_command(release.package_name, release.version))
		}

		return spawn_step(target, step, STEP_COMMANDS[step] ?? [])
	}
}

// The dry-run runner: it reports what each step would do and touches nothing.
function describe_step(target: PropagateTarget, step: string): StepResult {
	console.info(`  ${target.repo}: would run ${step}`)

	return { step, is_ok: true }
}

const propagate_steps = {
	STEP_COMMANDS,
	upgrade_command,
	return_step,
	VERIFY_SCRIPT,
	issue_title,
	issue_body,
	parse_issue_number,
	open_issue,
	precheck_step,
	create_step_runner,
	describe_step,
}

export type { Release }
export { propagate_steps }
