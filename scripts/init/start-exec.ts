import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { git_location_environment } from '#scripts/git/git-location-environment'
import { git_spawn_sync } from '#scripts/git/git-spawn-sync'
import { COMMAND_TIMEOUT_MS, SUITE_TIMEOUT_MS } from '#scripts/lib/timeouts'
import { execaSync } from 'execa'
import type { Visibility } from './start-plan'

// The spawn shapes every `josh start` step uses, shared by `start-steps.ts`, the setup pull request
// step and the `josh init` hint so none of them keeps a copy of its own.
//
// The git shapes below act on `root`, so `cwd` has to mean it: an inherited `GIT_DIR` and friends beat `cwd`
// and would carry a `git init` or commit into whichever repository a calling hook was firing in.
//
// **Every git and gh call here is bounded**. A read asks the local
// repository and takes git's own budget. A write — and `gh repo create --push` — can fire the
// project's own commit and push hooks, which may run its whole suite, so it takes the suite budget:
// long enough for that, short enough that a push that never answers ends the run.
const SUCCESS_EXIT_CODE = 0

function root_environment(): Record<string, string | undefined> {
	return git_location_environment.location_free_environment()
}

function git_succeeds(args: ReadonlyArray<string>, root: string): boolean {
	return git_spawn_sync.run(args, { cwd: root, env: root_environment() }).exit_code === 0
}

function git_read(args: ReadonlyArray<string>, root: string): string | undefined {
	return git_spawn_sync.read(args, { cwd: root, env: root_environment() })
}

function git_run(args: ReadonlyArray<string>, root: string): void {
	const options = { cwd: root, env: root_environment(), timeout: SUITE_TIMEOUT_MS }
	const { exit_code } = git_spawn_sync.run(args, { ...options, stdio: 'inherit' })

	if (exit_code === SUCCESS_EXIT_CODE) return

	const outcome = exit_code === undefined ? 'did not finish' : `exited with ${String(exit_code)}`

	throw new Error(`git ${args.join(' ')} ${outcome}`)
}

// Every gh spawn here dials GitHub directly, past a scanner's loopback proxy, the same as every
// other `gh` spawn under scripts/. Each argument list is written inline so
// `gh-subcommand-guard.ts` reads its subcommand rather than `<dynamic>`.
interface GhProbeOptions {
	cwd: string
	env: Record<string, string | undefined>
	timeout: number
	reject: false
}

function gh_probe_options(root: string): GhProbeOptions {
	const environment = { ...root_environment(), ...git_gh_exec.direct_environment().env }

	return { cwd: root, env: environment, timeout: COMMAND_TIMEOUT_MS, reject: false }
}

function is_gh_installed(root: string): boolean {
	const result = execaSync('gh', ['--version'], gh_probe_options(root)) // NOSONAR S8705: execa array args (no shell), trusted dev CLI tooling

	return result.exitCode === SUCCESS_EXIT_CODE
}

function is_gh_signed_in(root: string): boolean {
	const result = execaSync('gh', ['auth', 'status'], gh_probe_options(root)) // NOSONAR S8705: execa array args (no shell), trusted dev CLI tooling

	return result.exitCode === SUCCESS_EXIT_CODE
}

function create_github_repository(name: string, visibility: Visibility, root: string): void {
	const source = ['--source', '.', '--remote', 'origin', '--push']
	const { env } = gh_probe_options(root)
	const options = { cwd: root, env, timeout: SUITE_TIMEOUT_MS, stdio: 'inherit' } as const

	execaSync('gh', ['repo', 'create', name, `--${visibility}`, ...source], options) // NOSONAR S8705: execa array args (no shell), trusted dev CLI tooling
}

// A caller's own initialize command stands in for the in-process `josh init`, so it keeps the
// environment that setup would have had — its install goes through a scanner's proxy as usual.
function run_local(command: string, args: ReadonlyArray<string>, root: string): void {
	execaSync(command, args, { cwd: root, stdio: 'inherit' })
}

const start_exec = {
	git_succeeds,
	git_read,
	git_run,
	is_gh_installed,
	is_gh_signed_in,
	create_github_repository,
	run_local,
}

export { start_exec }
