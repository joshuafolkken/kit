#!/usr/bin/env tsx
import { existsSync } from 'node:fs'
import path from 'node:path'
import { text } from 'node:stream/consumers'
import { fileURLToPath } from 'node:url'
import { resolve_local_bin, resolve_package_bin } from '#scripts/local-bin'
import { execa } from 'execa'
import { z } from 'zod'

// Claude Code hands a `PostToolUse` hook the tool call as JSON on stdin; for `Edit` and `Write` the
// edited path is `tool_input.file_path`. Everything else in the payload is ignored, and a payload
// that does not carry a path is a no-op rather than an error — this hook runs after the edit has
// already been applied and must never turn a successful edit into a failure.
const hook_payload_schema = z.object({
	tool_input: z.object({ file_path: z.string().min(1) }).optional(),
})

// What prettier is asked to write. Kept explicit rather than deferring to `--ignore-unknown` alone
// so the hook's cost is bounded by a list that can be read, and so a path this project has no
// opinion about never spawns a process at all.
const PRETTIER_EXTENSIONS = new Set([
	'.ts',
	'.tsx',
	'.js',
	'.jsx',
	'.mjs',
	'.cjs',
	'.svelte',
	'.json',
	'.jsonc',
	'.md',
	'.yml',
	'.yaml',
	'.css',
	'.html',
])

// eslint only runs where the config has rules to apply. A `--fix` pass on a `.md` or `.yml` file
// costs a process start to do nothing.
const ESLINT_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.svelte'])

// Never this project's to format, however the edit reached them. Split in two because depth means
// different things: an installed package or a git internal is off-limits wherever it sits, while
// `dist` and `build` name build output only at the top level — `src/routes/build/+page.ts` is
// ordinary source, and excluding it by name would switch the hook off for a real part of the tree.
const EXCLUDED_ANYWHERE = new Set(['node_modules', '.git'])
const EXCLUDED_AT_ROOT = new Set(['dist', 'build'])
const PARENT_SEGMENT = '..'

// The shims under `node_modules/.bin` are spawned directly rather than through `pnpm exec`. This
// runs on every edit, and each `pnpm exec` is another process start on a chain that already holds
// `pnpm josh` and tsx — the two saved are the ones this file controls.
const PNPM = 'pnpm'
const PRETTIER_BIN = 'prettier'
const PRETTIER_ARGUMENTS: ReadonlyArray<string> = ['--write', '--ignore-unknown']
// `--no-error-on-unmatched-pattern` covers a file the eslint config does not cover: the hook has
// nothing to say about it, and a non-zero exit here would be reported as a failed hook.
const ESLINT_BIN = 'eslint'
const ESLINT_ARGUMENTS: ReadonlyArray<string> = ['--fix', '--no-error-on-unmatched-pattern']
// eslint is what this hook spends its time on, and almost none of it is the file: measured on this
// repository, one `eslint --fix` on a single TypeScript file takes 1.70s of a 2.50s hook, and a
// second lint inside the same process takes 0.13s. The 1.6s difference is the flat config, its
// plugins and the type-aware program, rebuilt from nothing on every edit. `eslint_d` keeps one warm
// eslint — the *project's* own eslint, held to that by `ESLINT_D_MISS=fail` below rather than by
// hope — behind a socket and forwards the same arguments to it, which is why the fixed output is
// identical rather than merely similar. The config entry file is re-read per request; the modules it
// imports are not, which `plan_daemon_restart` below is the answer to. The daemon exits after 15
// minutes of inactivity (joshuafolkken/kit#1259).
const ESLINT_DAEMON = 'eslint_d'
const DAEMON_RESTART = 'restart'
// The two shapes a flat config is built from here and in every consumer of this kit: the root
// `eslint.config.*` entry, and the rule modules under `eslint/` that it imports.
const ESLINT_CONFIG_DIR = 'eslint'
const ESLINT_CONFIG_ENTRY = /^eslint\.config\.[cm]?[jt]s$/u
// A formatter that hangs would hold the edit's turn open, so each spawn is bounded. The bound has
// to be read against the *worst-case run* rather than one spawn: an edit to a config input plans
// eslint, prettier and `eslint_d restart`, and the first and last each have a second route behind
// the daemon — five spawns. The hook entry in `.claude/settings.json` declares 90 seconds, so the
// per-spawn bound must leave five of them under it, or the harness kill lands first and lands at a
// moment this file did not choose — possibly inside `prettier --write`, which rewrites in place and
// can leave the file truncated. 15s × 5 = 75s. It is still two orders of magnitude beyond the 0.84s
// a warm run takes, so reaching it means something is already wrong.
const PROCESS_TIMEOUT_MS = 15_000

// Where this file sits inside the kit package. `eslint_d` is kit's dependency rather than the
// consumer's, and pnpm writes a `node_modules/.bin` shim only for a project's *direct* dependencies,
// so a consumer's project root cannot see it and this directory can.
const MODULE_DIRECTORY = path.dirname(fileURLToPath(import.meta.url))

interface FormatCommand {
	bin: string
	command_arguments: ReadonlyArray<string>
}

// The three ways this hook can reach a formatter, fastest first — a warm daemon, the project's own
// shim, then `pnpm exec`. Each later route exists because the one before it can be absent, so a
// project without the daemon behaves exactly as it did before it was introduced. Both fields are
// declared rather than optional: `exactOptionalPropertyTypes` makes an absent key and an explicit
// `undefined` different types, and every caller here computes the value rather than omitting it.
interface BinRoutes {
	daemon_cli: string | undefined
	shim: string | undefined
}

// What one spawn answered. The exit code alone cannot say whether a formatter ran, because
// `eslint --fix` exits non-zero whenever something it could not fix remains — its ordinary outcome
// on a half-written file. Pairing it with "did anything reach stdout" is what separates the two:
// eslint prints the problems it is exiting non-zero about, while a daemon that could not start
// prints its reason to stderr and leaves stdout empty.
interface CommandOutcome {
	exit_code: number
	did_write_stdout: boolean
}

type CommandRunner = (command: FormatCommand, project_root: string) => Promise<CommandOutcome>

function parse_edited_path(raw_payload: string): string | undefined {
	try {
		const result = hook_payload_schema.safeParse(JSON.parse(raw_payload))

		return result.success ? result.data.tool_input?.file_path : undefined
	} catch {
		return undefined
	}
}

// Read against the path relative to the project root, never the absolute one: a checkout that lives
// under a directory called `build` or `dist` would otherwise have the hook silently switched off for
// every file in it.
function is_excluded(relative_path: string): boolean {
	const segments = relative_path.split(path.sep)

	return (
		segments.some((segment) => EXCLUDED_ANYWHERE.has(segment)) ||
		EXCLUDED_AT_ROOT.has(segments[0] ?? '')
	)
}

// Claude Code runs a hook from the project directory, and this project's prettier and eslint config
// is the only config the hook has. An edit can still land outside that tree — a session may carry
// additional working directories, and paths in another checkout or a home-directory config file are
// governed by their own rules — so a path that is not under the root is left alone rather than
// rewritten to kit's taste.
// Returns the path relative to the root, or nothing when the file is not under it. The first
// segment is compared to `..` rather than tested as a prefix: `..config.ts` is a file in the root,
// not a step above it.
function relative_to_root(project_root: string, file_path: string): string | undefined {
	const relative = path.relative(path.resolve(project_root), path.resolve(file_path))
	const is_inside_root =
		relative !== '' && relative.split(path.sep)[0] !== PARENT_SEGMENT && !path.isAbsolute(relative)

	return is_inside_root ? relative : undefined
}

// One question, asked before any list is built: is this a file this project formats at all?
function is_formattable(file_path: string, project_root: string): boolean {
	const relative = relative_to_root(project_root, file_path)

	return relative !== undefined && !is_excluded(relative) && existsSync(file_path)
}

// Returns the commands to run, in order. eslint goes first and prettier last so prettier has the
// final word: an `--fix` that removes a now-unused disable directive leaves the whitespace behind
// it, and running in the other order shipped exactly that — a file the hook had just "formatted"
// that `prettier --check` then rejected. An empty list means the hook has nothing to do: the file is
// outside the project, gone by the time the hook ran, or of a kind nothing formats.
function plan_commands(file_path: string, project_root: string): ReadonlyArray<FormatCommand> {
	if (!is_formattable(file_path, project_root)) return []

	const extension = path.extname(file_path).toLowerCase()
	const commands: Array<FormatCommand> = []

	if (ESLINT_EXTENSIONS.has(extension)) {
		commands.push({ bin: ESLINT_BIN, command_arguments: [...ESLINT_ARGUMENTS, file_path] })
	}

	if (PRETTIER_EXTENSIONS.has(extension)) {
		commands.push({ bin: PRETTIER_BIN, command_arguments: [...PRETTIER_ARGUMENTS, file_path] })
	}

	return commands
}

// The daemon when it is installed, the local shim when it is there, `pnpm exec` when neither is. A
// workspace sub-package keeps its binaries somewhere other than the root's `node_modules/.bin`, and
// with output ignored a missing shim would otherwise make the hook a permanent silent no-op rather
// than a slower one. Kept pure and separate from the disk lookups so the choice itself is what the
// unit tests read.
function select_invocation(command: FormatCommand, routes: BinRoutes): FormatCommand {
	if (routes.daemon_cli !== undefined) {
		return {
			bin: process.execPath,
			command_arguments: [routes.daemon_cli, ...command.command_arguments],
		}
	}

	if (routes.shim !== undefined) {
		return { bin: routes.shim, command_arguments: command.command_arguments }
	}

	return { bin: PNPM, command_arguments: ['exec', command.bin, ...command.command_arguments] }
}

// Only eslint has a daemon here. prettier costs 0.21s against eslint's 1.70s, so a second warm
// process would buy little and double what can go stale. `eslint_d` itself is in the set because the
// restart below is addressed to the daemon rather than to a formatter.
const DAEMON_BINS: ReadonlySet<string> = new Set([ESLINT_BIN, ESLINT_DAEMON])

function resolve_daemon_cli(bin: string, project_root: string): string | undefined {
	if (!DAEMON_BINS.has(bin)) return undefined

	return (
		resolve_package_bin(MODULE_DIRECTORY, ESLINT_DAEMON, ESLINT_DAEMON) ??
		resolve_package_bin(project_root, ESLINT_DAEMON, ESLINT_DAEMON)
	)
}

// Only the config *entry file* is re-read per request: ESLint cache-busts `eslint.config.js` by
// appending its mtime to the import URL, and the modules that file imports carry no such query, so a
// long-lived daemon keeps the rule modules it loaded first. Edit `eslint/rules/naming-convention.js`
// and then any source file, and it would be auto-fixed against the pre-edit rules for as long as the
// daemon lives — an author testing a rule change would read that as the rule being broken. Restarting
// after an edit to a config input is what makes the whole config current, not just its first file.
function is_eslint_config_input(relative_path: string): boolean {
	return (
		relative_path.split(path.sep)[0] === ESLINT_CONFIG_DIR ||
		ESLINT_CONFIG_ENTRY.test(relative_path)
	)
}

function plan_daemon_restart(
	file_path: string,
	project_root: string,
): ReadonlyArray<FormatCommand> {
	const relative = relative_to_root(project_root, file_path)

	if (relative === undefined || !is_eslint_config_input(relative)) return []
	if (resolve_daemon_cli(ESLINT_DAEMON, project_root) === undefined) return []

	return [{ bin: ESLINT_DAEMON, command_arguments: [DAEMON_RESTART] }]
}

// The routes to try, fastest first. The second entry is the one that has always been here, and it
// is what a project with no daemon runs directly — resolving the daemon is not the same as it
// starting, so the slower route stays reachable rather than being replaced.
function resolve_invocations(
	command: FormatCommand,
	project_root: string,
): ReadonlyArray<FormatCommand> {
	const shim = resolve_local_bin(project_root, command.bin)
	const routes: BinRoutes = {
		daemon_cli: resolve_daemon_cli(command.bin, project_root),
		shim: existsSync(shim) ? shim : undefined,
	}
	const without_daemon = select_invocation(command, { ...routes, daemon_cli: undefined })

	if (routes.daemon_cli === undefined) return [without_daemon]

	return [select_invocation(command, routes), without_daemon]
}

// A daemon that resolved on disk can still fail to start — a blocked loopback bind, a watch-limit
// refusal, a read-only store it cannot write its own config into — and it says so on stderr while
// exiting non-zero with nothing on stdout. `ESLINT_D_MISS=fail` below lands in the same shape.
// Without this the hook would silently stop fixing anything with eslint wherever the daemon cannot
// run, which is the "permanent silent no-op rather than a slower one" the shim fallback exists to
// prevent, reintroduced one level up.
function is_start_failure(outcome: CommandOutcome): boolean {
	return outcome.exit_code !== 0 && !outcome.did_write_stdout
}

// `cwd` is not decoration: the daemon runs each request under the cwd of the process that forwarded
// it, so it is what decides which eslint installation and which flat config answer.
// `ESLINT_D_MISS=fail` refuses the bundled eslint the daemon would otherwise fall back to when the
// project's own is not resolvable — the hook must format with the project's eslint or not at all,
// and a refusal here is a start failure, which the caller retries on the slower route.
async function spawn_invocation(
	invocation: FormatCommand,
	project_root: string,
): Promise<CommandOutcome> {
	const result = await execa(invocation.bin, [...invocation.command_arguments], {
		reject: false,
		cwd: project_root,
		env: { ESLINT_D_MISS: 'fail' },
		stdout: 'pipe',
		stderr: 'ignore',
		timeout: PROCESS_TIMEOUT_MS,
	})

	return { exit_code: result.exitCode ?? 1, did_write_stdout: result.stdout.length > 0 }
}

// One planned command, tried down its routes. A route is retried only when the one before it failed
// to start — never when the formatter itself reported problems, which is its normal way of exiting.
async function run_command(command: FormatCommand, project_root: string): Promise<CommandOutcome> {
	let outcome: CommandOutcome = { exit_code: 0, did_write_stdout: false }

	for (const invocation of resolve_invocations(command, project_root)) {
		outcome = await spawn_invocation(invocation, project_root)
		if (!is_start_failure(outcome)) return outcome
	}

	return outcome
}

// Nothing here reports failure. A `PostToolUse` hook runs after the edit has landed, so a formatter
// that cannot parse a half-written file has nothing useful to say about a write that already
// succeeded — it stops, and the completion gate's own lint run is what reports on the file later.
async function format_edited_file(
	raw_payload: string,
	runner: CommandRunner,
	project_root: string,
): Promise<void> {
	const file_path = parse_edited_path(raw_payload)

	if (file_path === undefined) return

	const plan = [
		...plan_commands(file_path, project_root),
		...plan_daemon_restart(file_path, project_root),
	]

	for (const command of plan) {
		try {
			await runner(command, project_root)
		} catch {
			// One formatter failing to start is not a reason to skip the next: prettier runs last, and
			// it is the one whose output the project's own lint step checks.
			continue
		}
	}
}

// Run from a terminal there is no payload coming, and waiting for one looks like a hang.
function report_no_payload(): void {
	process.stderr.write(
		'format:edited reads a Claude Code PostToolUse payload on stdin; it is not run by hand.\n',
	)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	if (process.stdin.isTTY) {
		report_no_payload()
	} else {
		await format_edited_file(await text(process.stdin), run_command, process.cwd())
	}
}

export {
	format_edited_file,
	is_start_failure,
	parse_edited_path,
	plan_commands,
	plan_daemon_restart,
	relative_to_root,
	resolve_invocations,
	select_invocation,
	ESLINT_DAEMON,
	PROCESS_TIMEOUT_MS,
}
export type { BinRoutes, CommandOutcome, CommandRunner, FormatCommand }
