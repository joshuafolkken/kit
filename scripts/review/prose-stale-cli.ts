#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { change_base } from '#scripts/git/change-base'
import { git_spawn } from '#scripts/git/git-spawn'
import { prose_stale_read } from './prose-stale-read'
import { prose_stale_scan } from './prose-stale-scan'

// `josh prose:stale` — each word the change removed (a declared or exported name, a `josh x:y` command, an
// `UPPER_CASE` constant, a `.md` heading) that a `.md` line or a comment line under prompts, docs,
// .claude or scripts still names, as `file:line kind word`; `ok` when none (joshuafolkken/kit#5287).
// The diff runs from the change base to the working tree, so an uncommitted edit counts. Exit 1 on a
// reference, 2 when the base or a search could not be read.

const USAGE = 'usage: josh prose:stale'
const NO_BASE = 'prose:stale: no change base — fetch the default branch, then re-run'
// `process.argv` holds the runtime and the script before the command's own arguments.
const FIRST_ARGUMENT = 2

function refuse(message: string): number {
	console.error(message)

	return prose_stale_scan.FAILED_EXIT
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	if (argv.length > 0) return refuse(USAGE)

	const base = await change_base.resolved()

	if (base === undefined) return refuse(NO_BASE)

	const root = await git_spawn.read(['rev-parse', '--show-toplevel'])
	const hunks = await prose_stale_read.read_hunks(root, base)
	const { text, exit_code } = prose_stale_scan.report(
		await prose_stale_read.references(root, hunks),
	)

	console.info(text)

	return exit_code
}

// A git call that throws (no repository, a diff that failed) exits 2, never 1's "found".
async function guarded(argv: ReadonlyArray<string>): Promise<number> {
	try {
		return await run(argv)
	} catch (error) {
		return refuse(`prose:stale: ${String(error)}`)
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exitCode = await guarded(process.argv.slice(FIRST_ARGUMENT))
}

const prose_stale_cli = { guarded, run }

export { prose_stale_cli }
