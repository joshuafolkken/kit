import { git_gh_exec } from '#scripts/git/git-gh-exec'
import { git_gh_issue_write } from '#scripts/git/git-gh-issue-write'
import { GATE_COMMAND } from '#scripts/josh/josh-command-types'
import { build_upgrade_shell_command } from '#scripts/version/upgrade-shell-command'
import { create_version_command_config } from '#scripts/version/version-command-config'
import { execaSync } from 'execa'
import { propagate_git } from './propagate-git'
import { propagate_git_failure } from './propagate-git-failure'
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

// The commands the release-independent spawning steps run inside the target's own directory. The
// upgrade and the sync are not here: both are per toolkit, so they are built from the plan instead.
const STEP_COMMANDS: Readonly<Record<string, ReadonlyArray<string>>> = {
	[propagate_run.STEP_VERIFY]: ['sh', '-c', VERIFY_SCRIPT],
}

// kit's own CLI name. The sync is spelled through the *toolkit's* bin rather than hardcoded, because
// `@joshuafolkken/app-kit` syncs with `josh-app` and `@joshuafolkken/game-kit` with `josh-game`; a
// run that synced only `josh` would leave the other toolkit's managed files behind
// (joshuafolkken/kit#1085).
const JOSH_BIN = 'josh'

// `pnpm <bin>` resolves the target's own installed CLI, never this checkout — which is what keeps
// the sync a consumer-side sync and leaves kit's self-sync guard (joshuafolkken/kit#868) satisfied.
function sync_command(bin_name: string): ReadonlyArray<string> {
	return ['pnpm', bin_name, 'sync']
}

// The upgrade installs the version the plan names. For `josh propagate` that is the **exact**
// version that was waited for, not the registry's latest — `josh version:upgrade` resolves latest,
// which would defeat the exact-version wait: a release published while the run was in flight would
// be the one every consumer received. `josh adopt` names `latest` deliberately, because it is pulling
// whatever is newest inward rather than carrying one known release outward. Built through kit's own
// upgrade-command builder either way, so the lockfile repair it chains stays single-sourced.
function upgrade_command(package_name: string, version: string): ReadonlyArray<string> {
	const config = create_version_command_config({ package_name })

	return ['sh', '-c', build_upgrade_shell_command(version, true, config)]
}

const PROPAGATE_ORIGIN =
	'Opened by `josh propagate` from the supplier repository after the release was published.'
const RUN_NOTE =
	'The upgrade, the managed-file sync and the verification gate have already run here.'
const EMPTY_PLAN_TITLE = 'Upgrade the installed toolkits'
const LAST_SEPARATOR = ' and '
const NAME_SEPARATOR = ', '

function issue_title(package_name: string, version: string): string {
	return `Upgrade ${package_name} to ${version}`
}

// The packages a plan names, as English prose: one name alone, two joined by "and", more as a list
// with "and" before the last. `josh git` derives the branch name from this title, so it stays one
// plain line whatever the count.
function release_names(releases: ReadonlyArray<Release>): string {
	const names = releases.map((release) => release.package_name)
	const last = names.at(-1) ?? ''
	if (names.length <= 1) return last

	return `${names.slice(0, -1).join(NAME_SEPARATOR)}${LAST_SEPARATOR}${last}`
}

// One release reproduces `issue_title` exactly, which is what keeps a `propagate` run's issue title
// unchanged by the generalization.
function plan_title(releases: ReadonlyArray<Release>): string {
	const [first] = releases
	if (first === undefined) return EMPTY_PLAN_TITLE

	return issue_title(release_names(releases), first.version)
}

function plan_body(plan: ReleasePlan): string {
	const specs = plan.releases
		.map((release) => `\`${release.package_name}@${release.version}\``)
		.join(NAME_SEPARATOR)

	return [`Carry ${specs} into this repository.`, '', plan.origin, RUN_NOTE].join('\n')
}

function issue_body(package_name: string, version: string): string {
	return plan_body({
		releases: [{ package_name, version, bin_name: JOSH_BIN }],
		origin: PROPAGATE_ORIGIN,
	})
}

// A step's result together with what the step printed, one entry per stream.
interface SpawnOutcome {
	result: StepResult
	streams: ReadonlyArray<string>
}

const NO_COMMAND = 'no command defined'

function step_result(step: string, exit_code: number | undefined): StepResult {
	if (exit_code === SUCCESS_EXIT_CODE) return { step, is_ok: true }

	return { step, is_ok: false, detail: `exit ${String(exit_code ?? 'timed out')}` }
}

// Run a command in the consumer's directory with its output inherited, so a failing step shows why
// it failed rather than only `exit 1`, and so the long steps print as they run.
function spawn_step(
	target: PropagateTarget,
	step: string,
	command: ReadonlyArray<string>,
): StepResult {
	const [executable, ...rest] = command
	if (executable === undefined) return { step, is_ok: false, detail: NO_COMMAND }
	const spawned = execaSync(executable, rest, {
		cwd: target.path,
		reject: false,
		stdio: 'inherit',
		timeout: STEP_TIMEOUT_MS,
	})

	return step_result(step, spawned.exitCode)
}

// The same, keeping what the command printed. Only the pull-request step uses it: a consumer's
// pre-push hook names the check that stopped it in its own last lines, and until
// joshuafolkken/kit#1417 nothing in the run kept them — so the report had one exit code to attribute
// three sub-steps with, and attributed it to the wrong one.
//
// **This step's output is replayed when it finishes rather than printed as it runs**, and that is
// the price of keeping it. A synchronous spawn gives one target per file descriptor, so `['inherit',
// 'pipe']` cannot do both: execa buffers and writes the buffer out when the child exits. Nothing is
// lost, and the cost is confined to this one step — every other step above still streams, including
// the consumer's own verification gate, which is the long one. The alternative was to reproduce the
// message afterwards by pushing again with hooks enabled, which runs the consumer's whole gate a
// second time.
function spawn_captured(
	target: PropagateTarget,
	step: string,
	command: ReadonlyArray<string>,
): SpawnOutcome {
	const [executable, ...rest] = command

	if (executable === undefined) {
		return { result: { step, is_ok: false, detail: NO_COMMAND }, streams: [] }
	}

	const spawned = execaSync(executable, rest, {
		cwd: target.path,
		reject: false,
		stdin: 'inherit',
		stdout: ['inherit', 'pipe'],
		stderr: ['inherit', 'pipe'],
		timeout: STEP_TIMEOUT_MS,
	})

	return { result: step_result(step, spawned.exitCode), streams: [spawned.stdout, spawned.stderr] }
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

function create_issue(target: PropagateTarget, title: string, body: string): IssueOutcome {
	try {
		const url = git_gh_exec.exec_gh_api_sync(
			git_gh_issue_write.issue_create_request({ title, body, repo: target.repo }),
		)

		return { url }
	} catch (error) {
		return { detail: to_issue_detail(error) }
	}
}

function open_issue(target: PropagateTarget, package_name: string, version: string): IssueOutcome {
	return create_issue(target, issue_title(package_name, version), issue_body(package_name, version))
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
	plan: ReleasePlan,
	issue_numbers: Map<string, string>,
): StepResult {
	// Nothing changed, so there is nothing to open an issue about. Reached when the upgrade installed
	// a version the consumer already had and the sync rewrote no file; opening an issue and then
	// failing on an empty commit is the alternative.
	if (propagate_git.is_clean(target.path)) {
		return { step, is_ok: true, is_complete: true, detail: 'already current — nothing to commit' }
	}

	const outcome = create_issue(target, plan_title(plan.releases), plan_body(plan))
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
	plan: ReleasePlan,
	issue_numbers: ReadonlyMap<string, string>,
): StepResult {
	const number = issue_numbers.get(target.repo)
	if (number === undefined) return { step, is_ok: false, detail: 'no issue number' }
	const argument = `${plan_title(plan.releases)} #${number}`
	const outcome = spawn_captured(target, step, ['pnpm', 'josh', 'git', '-y', argument])
	if (outcome.result.is_ok) return outcome.result

	return propagate_git_failure.attribute(target.path, outcome.result, outcome.streams)
}

// One toolkit release being carried, as one value so the step handlers stay within the parameter
// limit. `bin_name` is the CLI that toolkit installs, which is what its own `sync` is spelled with.
interface Release {
	package_name: string
	version: string
	bin_name: string
}

// What one run carries: the releases, and the sentence naming the command that opened the issue.
// `josh propagate` always passes exactly one release; `josh adopt` passes every toolkit installed in
// the repository it runs in (joshuafolkken/kit#1085). Only the upgrade and the sync repeat per
// release — the pre-check, the verification gate, the issue, the pull request and the return to the
// default branch happen once, which is why the step order itself is unchanged.
interface ReleasePlan {
	releases: ReadonlyArray<Release>
	origin: string
}

// One release's command under a step that repeats per release. The package name travels with it so
// a failure can say *which* toolkit failed: the run's report is one line per target, and `exit 1`
// alone would leave a two-toolkit upgrade with nothing to act on.
interface ToolkitCommand {
	package_name: string
	command: ReadonlyArray<string>
}

// Run one command per release under a single step, stopping at the first failure. The step is
// reported once, so a failing toolkit ends the sequence before the gate rather than leaving a
// half-upgraded tree to be verified.
function run_each(
	target: PropagateTarget,
	step: string,
	commands: ReadonlyArray<ToolkitCommand>,
): StepResult {
	for (const { package_name, command } of commands) {
		const result = spawn_step(target, step, command)

		if (!result.is_ok) return { ...result, detail: `${package_name}: ${result.detail ?? 'failed'}` }
	}

	return { step, is_ok: true }
}

function upgrade_commands(plan: ReleasePlan): ReadonlyArray<ToolkitCommand> {
	return plan.releases.map((release) => ({
		package_name: release.package_name,
		command: upgrade_command(release.package_name, release.version),
	}))
}

function sync_commands(plan: ReleasePlan): ReadonlyArray<ToolkitCommand> {
	return plan.releases.map((release) => ({
		package_name: release.package_name,
		command: sync_command(release.bin_name),
	}))
}

// A step runner bound to one run. The issue number created for a target is kept here so the
// pull-request step can name it, without any module-level state to leak between runs.
function create_step_runner(plan: ReleasePlan): RunStep {
	const issue_numbers = new Map<string, string>()
	const handlers: Record<string, (target: PropagateTarget, step: string) => StepResult> = {
		[propagate_run.STEP_PRECHECK]: precheck_step,
		[propagate_run.STEP_UPGRADE]: (target, step) => run_each(target, step, upgrade_commands(plan)),
		[propagate_run.STEP_SYNC]: (target, step) => run_each(target, step, sync_commands(plan)),
		[propagate_run.STEP_ISSUE]: (target, step) => issue_step(target, step, plan, issue_numbers),
		[propagate_run.STEP_PR]: (target, step) => pull_request_step(target, step, plan, issue_numbers),
		[propagate_run.STEP_RETURN]: return_step,
	}

	return (target: PropagateTarget, step: string): StepResult => {
		console.info(`  ${target.repo}: ${step}`)
		const handler = handlers[step]

		if (handler !== undefined) return handler(target, step)

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
	JOSH_BIN,
	PROPAGATE_ORIGIN,
	sync_command,
	upgrade_command,
	upgrade_commands,
	sync_commands,
	return_step,
	VERIFY_SCRIPT,
	issue_title,
	issue_body,
	plan_title,
	plan_body,
	parse_issue_number,
	open_issue,
	precheck_step,
	create_step_runner,
	describe_step,
}

export type { Release, ReleasePlan }
export { propagate_steps }
