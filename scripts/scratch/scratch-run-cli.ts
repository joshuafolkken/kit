#!/usr/bin/env tsx
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { JOSH_SCRATCH_DIRECTORY } from '#scripts/lib/josh-temporary-directory'

// `josh scratch:run <path> [args…]` — runs a consultation script under Node's permission model.
//
// **It may write only into the scratch directory, and may not reach the network or start a child.** The
// child gets `--permission` with reads everywhere and writes to the scratch directory's real path; no
// `--allow-net` / `--allow-child-process` / `--allow-worker` / `--allow-addons`, so those fail at runtime.
//
// **It fails closed.** A script outside the scratch directory is refused, and so is every run on a Node
// that does not know `--allow-net` — there the permission model cannot keep the script off the network.

const ARGV_OFFSET = 2
const FAILURE_EXIT_CODE = 1
const USAGE = 'Usage: josh scratch:run <path> [args…]'
const NETWORK_FLAG = '--allow-net'
const IMPORT_FLAG = '--import'
// Lets the script import `scripts/` without extensions, as `scripts/` does (joshuafolkken/kit#8733).
const RESOLVE_HOOK_URL = new URL('scratch-resolve-hook.ts', import.meta.url).href

type NodeFlags = ReadonlySet<string>

function permission_arguments(scratch_root: string): ReadonlyArray<string> {
	return ['--permission', '--allow-fs-read=*', `--allow-fs-write=${scratch_root}`]
}

function is_inside(directory: string, file: string): boolean {
	const relative = path.relative(directory, file)

	return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}

function scratch_root_of(root: string): string {
	const scratch = path.resolve(root, JOSH_SCRATCH_DIRECTORY)

	mkdirSync(scratch, { recursive: true })

	return realpathSync(scratch)
}

// Why the run is refused, or undefined when it may start.
function refusal(
	name: string,
	script: string,
	scratch_root: string,
	flags: NodeFlags,
): string | undefined {
	if (name === '') return USAGE
	if (!flags.has(NETWORK_FLAG)) return `This Node does not know ${NETWORK_FLAG}; refusing to run`
	if (!existsSync(script)) return `Cannot find ${script}`

	if (!is_inside(scratch_root, realpathSync(script))) {
		return `${script} is outside ${JOSH_SCRATCH_DIRECTORY}; refusing to run`
	}

	return undefined
}

function launch(
	script: string,
	scratch_root: string,
	script_arguments: ReadonlyArray<string>,
): number {
	const real_script = realpathSync(script)
	const result = spawnSync(
		process.execPath,
		[
			...permission_arguments(scratch_root),
			IMPORT_FLAG,
			RESOLVE_HOOK_URL,
			real_script,
			...script_arguments,
		],
		// NODE_OPTIONS is dropped: an inherited `--allow-net` or `--allow-child-process` would widen the grant.
		{
			cwd: path.dirname(real_script),
			stdio: 'inherit',
			env: { ...process.env, NODE_OPTIONS: undefined },
		},
	)

	return result.status ?? FAILURE_EXIT_CODE
}

// The checkout a run resolves its script under, and the flags this Node knows.
interface RunScope {
	root?: string | undefined
	flags?: NodeFlags | undefined
}

function run_in(argv: ReadonlyArray<string>, root: string, flags: NodeFlags): number {
	const [name = '', ...script_arguments] = argv
	const script = path.resolve(root, name)
	const scratch_root = scratch_root_of(root)
	const reason = refusal(name, script, scratch_root, flags)

	if (reason !== undefined) {
		console.error(reason)

		return FAILURE_EXIT_CODE
	}

	return launch(script, scratch_root, script_arguments)
}

function run(
	argv: ReadonlyArray<string>,
	{ root = process.cwd(), flags = process.allowedNodeEnvironmentFlags }: RunScope = {},
): number {
	return run_in(argv, root, flags)
}

function main(argv: ReadonlyArray<string>): void {
	process.exitCode = run(argv)
}

const scratch_run_cli = { permission_arguments, run }

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(ARGV_OFFSET))

export { scratch_run_cli }
