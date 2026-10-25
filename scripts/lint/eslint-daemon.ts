import { createHash } from 'node:crypto'
import { lstatSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolve_package_bin } from '#scripts/build/local-bin'
import { toolchain_inputs } from '#scripts/gate/toolchain-inputs'
import { git_spawn_sync } from '#scripts/git/git-spawn-sync'
import { atomic_write } from '#scripts/lib/atomic-write'
import { buffered_process, type BufferedProcessResult } from '#scripts/lib/buffered-process'
import { execa } from 'execa'
import { eslint_daemon_sources } from './eslint-daemon-sources'

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
const NODE_MODULES = 'node_modules'
// `eslint_d` writes `<token> <port> <pid> <hash>` here once, when the daemon has started, and removes
// it when the daemon stops — so its text names one daemon.
const DAEMON_RECORD = '.eslint_d'
// What that daemon loaded: its record's text and the fingerprint it started under, written beside it.
const FINGERPRINT_RECORD = '.eslint_d-toolchain'
const RECORD_SEPARATOR = '\n'
const NO_HEAD = 'no-head'
// Every file the type program could resolve: tracked, staged by a merge in progress, or new.
const LIST_FILES: ReadonlyArray<string> = ['ls-files', '--cached', '--others', '--exclude-standard']
const DIGEST_ALGORITHM = 'sha256'

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

interface DaemonRecord {
	// The running daemon's own record, or nothing when none runs.
	daemon: string | undefined
	// What `remember` wrote for the daemon it last saw start.
	recorded: string | undefined
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

// The flat config, the type program's options and the installed packages a consumer's config imports
// its rules from — typescript-eslint's project service watches none of them (joshuafolkken/kit#4494).
function is_config_input(relative_path: string): boolean {
	return toolchain_inputs.is_input(relative_path)
}

// The eslint arguments of a `pnpm exec eslint …` list, or nothing when the list runs another tool.
function eslint_arguments_of(
	pnpm_arguments: ReadonlyArray<string>,
): ReadonlyArray<string> | undefined {
	if (pnpm_arguments[0] !== PNPM_EXEC || pnpm_arguments[1] !== ESLINT_BIN) return undefined

	return pnpm_arguments.slice(PNPM_ESLINT_PREFIX_LENGTH)
}

function digest_of(text: string): string {
	return createHash(DIGEST_ALGORITHM).update(text).digest('hex')
}

// **What a daemon is current for: the toolchain's content and the commit checked out.** The daemon's
// type program keeps every source it read but did not lint, so a merge that changes those types leaves
// typed rules failing on the old ones (joshuafolkken/kit#4443); every merge, checkout, reset, pull and
// commit moves HEAD, the commands that move sources under the daemon without an edit the hook sees.
// A content digest rather than a time: a copy or a checkout rewrites every mtime and leaves the
// content alone, and an edit can keep its old mtime. Outside a repository there is no HEAD.
// **The files the program can resolve, too**: a merge whose conflicts are being resolved brings main's
// new modules in without moving HEAD, and a daemon that had built its program before they arrived
// reported their types as unresolvable until it was stopped (joshuafolkken/kit#4701).
// **And the content of every file that differs from HEAD**, each on a line of its own after the rest
// (`eslint-daemon-sources.ts`): an edit the hook lints is read fresh and refreshes its own line, and a
// shell edit it never saw restarts the daemon (joshuafolkken/kit#4867).
function fingerprint(project_root: string): string {
	const head = git_spawn_sync.read(['rev-parse', 'HEAD'], { cwd: project_root }) ?? NO_HEAD
	const files = git_spawn_sync.read(LIST_FILES, { cwd: project_root }) ?? NO_HEAD
	const inputs = `${toolchain_inputs.digest(project_root)}:${head}:${digest_of(files)}`
	const sources = eslint_daemon_sources.snapshot(project_root)

	return sources === '' ? inputs : `${inputs}${eslint_daemon_sources.LINE_SEPARATOR}${sources}`
}

// Where the eslint the daemon resolves keeps its record, or nothing without an installed eslint.
function eslint_directory(project_root: string): string | undefined {
	try {
		return path.dirname(
			createRequire(path.join(project_root, 'package.json')).resolve('eslint/package.json'),
		)
	} catch {
		return undefined
	}
}

function read_text(file: string): string | undefined {
	try {
		return readFileSync(file, 'utf8')
	} catch {
		return undefined
	}
}

function read_record(project_root: string): DaemonRecord {
	const directory = eslint_directory(project_root)
	if (directory === undefined) return { daemon: undefined, recorded: undefined }

	return {
		daemon: read_text(path.join(directory, DAEMON_RECORD)),
		recorded: read_text(path.join(directory, FINGERPRINT_RECORD)),
	}
}

function record_text(daemon: string, current: string): string {
	return `${daemon}${RECORD_SEPARATOR}${current}`
}

// A daemon keeps the rule modules it imported first — eslint cache-busts only the config entry file —
// so a toolchain input that moved since it started leaves it linting against the old rules, and a
// HEAD move leaves it typing against the old sources. A daemon this module did not record — another
// tool started it, or the record is from an older one — is stale too: nothing says what it loaded.
// The edit hook records the daemons it starts and restarts (`remember_after_edit`); this catches the rest.
function is_stale(record: DaemonRecord, current: string): boolean {
	if (record.daemon === undefined) return false

	return record.recorded !== record_text(record.daemon, current)
}

// Best-effort, like the daemon's own record: one that could not be written restarts the daemon once
// more on the next run.
function remember(project_root: string, current: string): void {
	const directory = eslint_directory(project_root)
	if (directory === undefined) return
	const daemon = read_text(path.join(directory, DAEMON_RECORD))
	if (daemon === undefined) return

	try {
		atomic_write.replace_file(
			path.join(directory, FINGERPRINT_RECORD),
			record_text(daemon, current),
		)
	} catch {
		// A lost record costs one restart.
	}
}

// The edit hook starts the daemon on its first eslint fix and restarts it after a config edit, each
// under the inputs as they are now, and a daemon's record changes with every start — so a record that
// changed across the hook's commands names a daemon they started. Recording it keeps the next lint run
// from stopping and cold-starting a daemon that is already current.
// A daemon that kept running has read the edited file fresh and nothing else, so only that file's
// line of a record that is current otherwise is refreshed.
// A borrowed install's record belongs to the lending checkout, whose files these are not.
function remember_read(project_root: string, record: DaemonRecord, relative: string): void {
	const { daemon, recorded } = record
	if (daemon === undefined || recorded === undefined || is_borrowed_install(project_root)) return
	const prefix = record_text(daemon, '')
	if (!recorded.startsWith(prefix)) return
	const current = eslint_daemon_sources.snapshot(project_root)

	remember(
		project_root,
		eslint_daemon_sources.refresh(recorded.slice(prefix.length), current, relative),
	)
}

function remember_after_edit(
	project_root: string,
	before: DaemonRecord,
	edited: string | undefined,
): void {
	const after = read_record(project_root)

	if (after.daemon !== before.daemon) remember(project_root, fingerprint(project_root))
	else if (edited !== undefined) remember_read(project_root, after, edited)
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

// The fingerprint is taken before the run, so an input that moves while the daemon starts is caught by
// the next one.
async function run_current(
	cli: string,
	eslint_arguments: ReadonlyArray<string>,
	options: DaemonRunOptions,
): Promise<DaemonOutcome | undefined> {
	const { project_root } = options
	const current = fingerprint(project_root)
	if (is_stale(read_record(project_root), current)) await spawn_daemon(cli, [DAEMON_STOP], options)

	const outcome = await spawn_daemon(cli, eslint_arguments, options)
	if (is_start_failure(outcome)) return undefined
	remember(project_root, current)

	return outcome
}

// The run through the warm daemon, or nothing when there is no daemon to reach or it failed to
// start — the caller then runs its own cold route, so a project without the daemon lints as before.
async function run(
	pnpm_arguments: ReadonlyArray<string>,
	options: DaemonRunOptions,
): Promise<DaemonOutcome | undefined> {
	const eslint_arguments = eslint_arguments_of(pnpm_arguments)
	if (eslint_arguments === undefined) return undefined
	const cli = resolve_daemon_cli(options.project_root)
	if (cli === undefined) return undefined

	return await run_current(cli, eslint_arguments, options)
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
	fingerprint,
	is_config_input,
	is_stale,
	read_record,
	record_text,
	remember_after_edit,
	resolve_daemon_cli,
	run,
	run_or_cold,
	ESLINT_DAEMON,
}

export type { DaemonOutcome, DaemonRecord }
export { eslint_daemon }
