import { git_grep_hits } from '#scripts/git/git-grep-hits'
import { git_spawn } from '#scripts/git/git-spawn'
import { COMMAND_MAP } from '#scripts/josh/josh-command-map'
import { test_pinned_logic, type Hunk } from '#scripts/test/test-pinned-logic'
import { prose_stale_scan, type Reference, type Term } from './prose-stale-scan'

// The git half of `josh prose:stale`: the diff from the change base to the working tree, and the
// search for each word it removed. Its own module, without a main guard, so `josh review:selfcheck`
// (joshuafolkken/kit#5540) imports it as well as `prose-stale-cli.ts`.

const SEARCH_PATHS = ['*.md', 'prompts', 'docs', '.claude', 'scripts', ':(exclude)CHANGELOG.md']

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

// `hunks` is the whole change: a declaration moved into another file of it is kept, not removed.
async function references(root: string, hunks: ReadonlyArray<Hunk>): Promise<Array<Reference>> {
	const registered = new Set(Object.keys(COMMAND_MAP))
	const terms = prose_stale_scan.stale_terms(hunks, registered)

	return await Promise.all(terms.map(async (term) => await reference_of(term, root)))
}

const prose_stale_read = { read_hunks, references }

export { prose_stale_read }
