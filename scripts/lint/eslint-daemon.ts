import { existsSync, lstatSync, readdirSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolve_package_bin } from '#scripts/build/local-bin'
import { git_spawn_sync } from '#scripts/git/git-spawn-sync'
import { buffered_process, type BufferedProcessResult } from '#scripts/lib/buffered-process'
import { execa } from 'execa'

// One warm eslint per checkout, reached by every eslint run that is not the gate's whole tree: the
// `PostToolUse` edit hook, `josh lint:related` and the pre-commit hook (joshuafolkken/kit#4358).
// `eslint_d` forwards the argument list to the project's own `eslint/lib/cli.js` → `execute`, run in
// the forwarding process's cwd, so the report, the exit code and the cache file are eslint's own:
// measured on this repository, a CLI run and a daemon run over the same files wrote byte-identical
// cache files, `--quiet` included, and printed identical reports.

const ESLINT_DAEMON = 'eslint_d'
const DAEMON_STOP = 'stop'
// The pnpm argument list every eslint caller here already builds. The daemon takes what follows it.
const PNPM_EXEC = 'exec'
const ESLINT_BIN = 'eslint'
const PNPM_ESLINT_PREFIX_LENGTH = 2
// The two shapes a flat config is built from here and in every consumer of this kit: the root
// `eslint.config.*` entry, and the rule modules under `eslint/` that it imports.
const ESLINT_CONFIG_DIR = 'eslint'
const ESLINT_CONFIG_ENTRY = /^eslint\.config\.[cm]?[jt]s$/u
// A consumer's config imports its rules from installed packages (`@joshuafolkken/app-kit/eslint…`),
// so an install is a config input too: pnpm rewrites `node_modules/.modules.yaml` on every install,
// and the lockfile on every dependency change a checkout or merge brings in.
const NODE_MODULES = 'node_modules'
const DEPENDENCY_INPUTS = ['pnpm-lock.yaml', path.join(NODE_MODULES, '.modules.yaml')]
// The daemon's type program keeps every source it read but did not lint, so a merge that changes
// those types leaves typed rules failing on the old ones (joshuafolkken/kit#4443). Git appends to this
// work tree's HEAD reflog on every merge, checkout, reset, pull and commit — the commands that move
// sources under the daemon without an edit the hook sees.
const HEAD_REFLOG = path.join('logs', 'HEAD')
// `eslint_d` writes `<token> <port> <pid> <hash>` here once, when the daemon has started — so the
// file's mtime is when the daemon loaded its config.
const DAEMON_RECORD = '.eslint_d'
const NOTHING_NEWER = 0

// Where this file sits inside the kit package. `eslint_d` is kit's dependency rather than the
// consumer's, and pnpm writes a `node_modules/.bin` shim only for a project's *direct* dependencies,
// so a consumer's project root cannot see it and this directory can.
const MODULE_DIRECTORY = path.dirname(fileURLToPath(import.meta.url))

interface DaemonOutcome {
	exit_code: number
	// stdout alone, which is what separates a report from a daemon that never answered.
	stdout: string
	// stdout and stderr interleaved, which is what a caller prints.
	output: string
}

interface DaemonRunOptions {
	project_root: string
	timeout_ms?: number
}

// `eslint_d` keys its one daemon on the record beside the eslint it resolves, so a project that
// borrows another checkout's `node_modules` through a symlink — a test fixture's temporary
// repository — would start, restart and overwrite that checkout's daemon (joshuafolkken/kit#4386).
function is_borrowed_install(project_root: string): boolean {
	return (
		lstatSync(path.join(project_root, NODE_MODULES), {
			throwIfNoEntry: false,
		})?.isSymbolicLink() === true
	)
}

function resolve_daemon_cli(project_root: string): string | undefined {
	if (is_borrowed_install(project_root)) return undefined

	return (
		resolve_package_bin(MODULE_DIRECTORY, ESLINT_DAEMON, ESLINT_DAEMON) ??
		resolve_package_bin(project_root, ESLINT_DAEMON, ESLINT_DAEMON)
	)
}

function is_config_input(relative_path: string): boolean {
	return (
		relative_path.split(path.sep)[0] === ESLINT_CONFIG_DIR ||
		ESLINT_CONFIG_ENTRY.test(relative_path)
	)
}

// The eslint arguments of a `pnpm exec eslint …` list, or nothing when the list runs another tool.
function eslint_arguments_of(
	pnpm_arguments: ReadonlyArray<string>,
): ReadonlyArray<string> | undefined {
	if (pnpm_arguments[0] !== PNPM_EXEC || pnpm_arguments[1] !== ESLINT_BIN) return undefined

	return pnpm_arguments.slice(PNPM_ESLINT_PREFIX_LENGTH)
}

// A linked worktree's reflog lives under its own git directory, which `--git-path` resolves; outside
// a repository there is none.
function head_reflog_paths(project_root: string): ReadonlyArray<string> {
	const reflog = git_spawn_sync.read(['rev-parse', '--git-path', HEAD_REFLOG], {
		cwd: project_root,
	})

	return reflog === undefined ? [] : [path.resolve(project_root, reflog)]
}

function config_input_paths(project_root: string): ReadonlyArray<string> {
	const entries = readdirSync(project_root).filter((name) => ESLINT_CONFIG_ENTRY.test(name))
	const config_directory = path.join(project_root, ESLINT_CONFIG_DIR)
	// Files only: a directory's mtime moves on every entry created in it, an editor's temp file too.
	const modules = existsSync(config_directory)
		? readdirSync(config_directory, { recursive: true, withFileTypes: true })
				.filter((entry) => entry.isFile())
				.map((entry) => path.join(entry.parentPath, entry.name))
		: []

	return [
		...[...entries, ...DEPENDENCY_INPUTS].map((name) => path.join(project_root, name)),
		...modules,
		...head_reflog_paths(project_root),
	]
}

// A dependency input a project does not have (no install yet, another package manager), a file listed and then gone before its stat (an editor's atomic save, a checkout mid-run) or a
// dangling symlink counts as nothing newer rather than failing the lint it only decides a restart for.
function newest_config_mtime(project_root: string): number {
	return Math.max(
		NOTHING_NEWER,
		...config_input_paths(project_root).map(
			(file) => statSync(file, { throwIfNoEntry: false })?.mtimeMs ?? NOTHING_NEWER,
		),
	)
}

function daemon_started_ms(project_root: string): number | undefined {
	try {
		const eslint_manifest = createRequire(path.join(project_root, 'package.json')).resolve(
			'eslint/package.json',
		)

		return statSync(path.join(path.dirname(eslint_manifest), DAEMON_RECORD)).mtimeMs
	} catch {
		return undefined
	}
}

// A daemon keeps the rule modules it imported first — eslint cache-busts only the config entry file —
// so a config input written after it started (an edit, a `git merge`, a checkout) leaves it linting
// against the old rules, and a HEAD move after it started leaves it typing against the old sources.
// The edit hook restarts it on its own config edits; this catches the rest.
function is_stale(started_ms: number | undefined, newest_input_ms: number): boolean {
	return started_ms !== undefined && started_ms < newest_input_ms
}

// `cwd` decides which eslint installation and which flat config answer, and `ESLINT_D_MISS=fail`
// refuses the bundled eslint the daemon would otherwise fall back to.
async function spawn_daemon(
	cli: string,
	cli_arguments: ReadonlyArray<string>,
	options: DaemonRunOptions,
): Promise<DaemonOutcome> {
	const result = await execa(process.execPath, [cli, ...cli_arguments], {
		reject: false,
		all: true,
		cwd: options.project_root,
		env: { ...buffered_process.child_environment(), ESLINT_D_MISS: 'fail' },
		extendEnv: false,
		...(options.timeout_ms !== undefined && { timeout: options.timeout_ms }),
	})

	return { exit_code: result.exitCode ?? 1, stdout: result.stdout, output: result.all }
}

// The daemon prints every eslint line — stderr included — to its forwarder's stdout, and its own
// start failures to stderr with nothing on stdout.
function is_start_failure(outcome: DaemonOutcome): boolean {
	return outcome.exit_code !== 0 && outcome.stdout.length === 0
}

// The run through the warm daemon, or nothing when there is no daemon to reach or it failed to
// start — the caller then runs its own cold route, so a project without the daemon lints as before.
async function run(
	pnpm_arguments: ReadonlyArray<string>,
	options: DaemonRunOptions,
): Promise<DaemonOutcome | undefined> {
	const { project_root } = options
	const eslint_arguments = eslint_arguments_of(pnpm_arguments)
	if (eslint_arguments === undefined) return undefined
	const cli = resolve_daemon_cli(project_root)
	if (cli === undefined) return undefined

	if (is_stale(daemon_started_ms(project_root), newest_config_mtime(project_root))) {
		await spawn_daemon(cli, [DAEMON_STOP], options)
	}

	const outcome = await spawn_daemon(cli, eslint_arguments, options)

	return is_start_failure(outcome) ? undefined : outcome
}

// The warm run from the current directory, read as a buffered child's result, or the cold
// `pnpm exec eslint` when the daemon cannot answer — the one fallback `josh lint:related` and the
// pre-commit hook both take.
async function run_or_cold(pnpm_arguments: ReadonlyArray<string>): Promise<BufferedProcessResult> {
	const started_at = performance.now()
	const outcome = await run(pnpm_arguments, { project_root: process.cwd() })
	if (outcome === undefined) return await buffered_process.run_buffered_process(pnpm_arguments)

	return {
		output: outcome.output,
		exit_code: outcome.exit_code,
		elapsed_ms: performance.now() - started_at,
	}
}

const eslint_daemon = {
	eslint_arguments_of,
	is_config_input,
	is_stale,
	newest_config_mtime,
	resolve_daemon_cli,
	run,
	run_or_cold,
	ESLINT_DAEMON,
}

export type { DaemonOutcome }
export { eslint_daemon }
