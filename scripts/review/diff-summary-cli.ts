#!/usr/bin/env tsx
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { change_base } from '#scripts/git/change-base'
import { git_command } from '#scripts/git/git-command'
import { git_spawn } from '#scripts/git/git-spawn'
import { diff_summary } from './diff-summary'

// `josh diff:summary [<base>]` — the diff from `<base>` (default: the change base) to the working tree
// as one table per file, the full diff saved for a ranged read (joshuafolkken/kit#5547). The file goes
// in this worktree's own git directory, so it never shows as a working-tree change.
// Exit 0, 2 when the base or the diff could not be read.

const USAGE = 'usage: josh diff:summary [<base>]'
const NO_BASE = 'diff:summary: no change base — fetch the default branch, or name a base'
const SAVED_NAME = 'josh-diff-summary.patch'
const FAILED_EXIT = 2
const MAX_ARGUMENTS = 1
// `process.argv` holds the runtime and the script before the command's own arguments.
const FIRST_ARGUMENT = 2
// Unquoted paths, so a non-ASCII file name starts its own row instead of folding into the one above
// (the reason `git-diff-reads.ts`'s `NO_PATH_QUOTING` gives).
const DIFF_ARGUMENTS: ReadonlyArray<string> = [
	'-c',
	'core.quotePath=false',
	'diff',
	'--no-color',
	'--no-ext-diff',
	'--src-prefix=a/',
	'--dst-prefix=b/',
]

function refuse(message: string): number {
	console.error(message)

	return FAILED_EXIT
}

async function save(diff: string): Promise<string> {
	const [git_directory = ''] = await git_command.git_directories()
	const saved_path = path.join(git_directory, SAVED_NAME)

	await writeFile(saved_path, diff)

	return saved_path
}

async function summarize(base: string): Promise<string> {
	const diff = await git_spawn.read([...DIFF_ARGUMENTS, base, '--'])

	return diff_summary.report(diff, base, await save(diff))
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	if (argv.length > MAX_ARGUMENTS) return refuse(USAGE)

	const base = argv[0] ?? (await change_base.resolved())

	if (base === undefined) return refuse(NO_BASE)

	console.info(await summarize(base))

	return 0
}

async function guarded(argv: ReadonlyArray<string>): Promise<number> {
	try {
		return await run(argv)
	} catch (error) {
		return refuse(`diff:summary: ${String(error)}`)
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exitCode = await guarded(process.argv.slice(FIRST_ARGUMENT))
}

const diff_summary_cli = { guarded, run }

export { diff_summary_cli }
