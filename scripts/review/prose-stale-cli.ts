#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { change_base } from '#scripts/git/change-base'
import { git_grep_hits } from '#scripts/git/git-grep-hits'
import { git_spawn } from '#scripts/git/git-spawn'
import { COMMAND_MAP } from '#scripts/josh/josh-command-map'
import { test_pinned_logic, type Hunk } from '#scripts/test/test-pinned-logic'
import { prose_stale_scan, type Reference, type Term } from './prose-stale-scan'

// `josh prose:stale` — each word the change removed (an export name, a `josh x:y` command, an
// `UPPER_CASE` constant, a `.md` heading) that a `.md` line or a comment line under prompts, docs,
// .claude or scripts still names, as `file:line kind word`; `ok` when none (joshuafolkken/kit#5287).
// The diff runs from the change base to the working tree, so an uncommitted edit counts. Exit 1 on a
// reference, 2 when the base or a search could not be read.

const USAGE = 'usage: josh prose:stale'
const NO_BASE = 'prose:stale: no change base — fetch the default branch, then re-run'
const SEARCH_PATHS = ['*.md', 'prompts', 'docs', '.claude', 'scripts', ':(exclude)CHANGELOG.md']
// `process.argv` holds the runtime and the script before the command's own arguments.
const FIRST_ARGUMENT = 2

async function read_hunks(root: string, base: string): Promise<Array<Hunk>> {
	const diff = await git_spawn.read([
		'-C',
		root,
		'diff',
		'-U0',
		'--no-color',
		'--no-ext-diff',
		'--src-prefix=a/',
		'--dst-prefix=b/',
		base,
	])

	return test_pinned_logic.all_hunks(diff)
}

async function reference_of(term: Term, root: string): Promise<Reference> {
	const { target, flags } = prose_stale_scan.pattern(term)
	const { hits, has_failed } = await git_grep_hits.search(target, flags, SEARCH_PATHS, root)

	return { term, hits, has_failed }
}

async function references(root: string, base: string): Promise<Array<Reference>> {
	const registered = new Set(Object.keys(COMMAND_MAP))
	const terms = prose_stale_scan.stale_terms(await read_hunks(root, base), registered)

	return await Promise.all(terms.map(async (term) => await reference_of(term, root)))
}

function refuse(message: string): number {
	console.error(message)

	return prose_stale_scan.FAILED_EXIT
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	if (argv.length > 0) return refuse(USAGE)

	const base = await change_base.resolved()

	if (base === undefined) return refuse(NO_BASE)

	const root = await git_spawn.read(['rev-parse', '--show-toplevel'])
	const { text, exit_code } = prose_stale_scan.report(await references(root, base))

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

const prose_stale_cli = { run }

export { prose_stale_cli }
