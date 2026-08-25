#!/usr/bin/env tsx
import { existsSync } from 'node:fs'
import path from 'node:path'
import { text } from 'node:stream/consumers'
import { fileURLToPath } from 'node:url'
import { resolve_local_bin } from '#scripts/local-bin'
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
// A formatter that hangs would hold the edit's turn open, so each one is bounded. The number is far
// beyond what formatting one file takes, so reaching it means something is already wrong — which
// matters because `prettier --write` rewrites in place and any kill can leave the file truncated.
// The hook entry in `.claude/settings.json` declares a longer budget than both runs together, so
// this bound is the one that fires first and the kill is at least at a moment this file chose.
const PROCESS_TIMEOUT_MS = 25_000

interface FormatCommand {
	bin: string
	command_arguments: ReadonlyArray<string>
}

type CommandRunner = (command: FormatCommand, project_root: string) => Promise<void>

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

// The local shim when it is there, `pnpm exec` when it is not. A workspace sub-package keeps its
// binaries somewhere other than the root's `node_modules/.bin`, and with output ignored a missing
// shim would otherwise make the hook a permanent silent no-op rather than a slower one.
function resolve_invocation(command: FormatCommand, project_root: string): FormatCommand {
	const shim = resolve_local_bin(project_root, command.bin)

	if (existsSync(shim)) return { bin: shim, command_arguments: command.command_arguments }

	return { bin: PNPM, command_arguments: ['exec', command.bin, ...command.command_arguments] }
}

async function run_command(command: FormatCommand, project_root: string): Promise<void> {
	const invocation = resolve_invocation(command, project_root)

	await execa(invocation.bin, [...invocation.command_arguments], {
		reject: false,
		stdio: 'ignore',
		timeout: PROCESS_TIMEOUT_MS,
	})
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

	for (const command of plan_commands(file_path, project_root)) {
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
	parse_edited_path,
	plan_commands,
	relative_to_root,
	resolve_invocation,
	PROCESS_TIMEOUT_MS,
}
export type { CommandRunner, FormatCommand }
