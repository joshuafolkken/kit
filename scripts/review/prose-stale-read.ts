import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { git_grep_hits } from '#scripts/git/git-grep-hits'
import { git_spawn } from '#scripts/git/git-spawn'
import { COMMAND_MAP } from '#scripts/josh/josh-command-map'
import { test_pinned_logic, type Hunk } from '#scripts/test/test-pinned-logic'
import { prose_stale_scan, type Reference, type Term, type Tree } from './prose-stale-scan'
import { review_readers_scan } from './review-readers-scan'

// The git half of `josh prose:stale`: the diff from the change base to the working tree, and the
// search for each word it removed. Its own module, without a main guard, so `josh review:selfcheck`
// (joshuafolkken/kit#5540) imports it as well as `prose-stale-cli.ts`.

const SEARCH_PATHS = ['*.md', 'prompts', 'docs', '.claude', 'scripts', ':(exclude)CHANGELOG.md']
// The code files a live declaration is looked for in, at any depth.
const CODE_PATHSPECS = ['*.ts', '*.js']

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

async function declared_in(root: string, files: ReadonlyArray<string>): Promise<Array<string>> {
	const sources = await Promise.all(
		files.map(async (file) => await readFile(path.join(root, file), 'utf8')),
	)

	return sources.flatMap((source) =>
		review_readers_scan.declarations(source).map(({ name }) => name),
	)
}

// The working tree's code files that write any of `names`, the deleted ones aside.
async function files_writing(root: string, names: ReadonlyArray<string>): Promise<Array<string>> {
	const results = await Promise.all(
		names.map(async (name) => await git_grep_hits.search(name, ['-w'], CODE_PATHSPECS, root)),
	)
	const files = new Set(results.flatMap(({ hits }) => hits.map((hit) => hit.path)))

	return [...files].filter((file) => existsSync(path.join(root, file)))
}

// A deleted file's reachable name a live module outside the change still declares names that module,
// not the deleted one (joshuafolkken/kit#7048): a removed namespace's `record` beside `gate-ledger.ts`'s.
async function declared_elsewhere(
	root: string,
	hunks: ReadonlyArray<Hunk>,
	deleted: ReadonlyArray<string>,
): Promise<Array<string>> {
	const gone = hunks.filter((hunk) => deleted.includes(hunk.file))
	const names = [
		...new Set(
			gone.flatMap((hunk) => review_readers_scan.reachable_names(hunk.old_lines.join('\n'))),
		),
	]
	const declared = new Set(await declared_in(root, await files_writing(root, names)))

	return names.filter((name) => declared.has(name))
}

// The names the change's code files declare in the working tree, an unchanged line included
// (joshuafolkken/kit#6077), and the files it deleted, which declare none (joshuafolkken/kit#6130).
async function tree_of(root: string, hunks: ReadonlyArray<Hunk>): Promise<Tree> {
	const files = [...new Set(hunks.map((hunk) => hunk.file))].filter((file) =>
		prose_stale_scan.CODE_FILE.test(file),
	)
	const present = files.filter((file) => existsSync(path.join(root, file)))
	const deleted = files.filter((file) => !present.includes(file))
	const surviving = [
		...(await declared_in(root, present)),
		...(await declared_elsewhere(root, hunks, deleted)),
	]

	return { surviving: new Set(surviving), deleted: new Set(deleted) }
}

// `hunks` is the whole change: a declaration moved into another file of it is kept, not removed.
async function references(root: string, hunks: ReadonlyArray<Hunk>): Promise<Array<Reference>> {
	const registered = new Set(Object.keys(COMMAND_MAP))
	const tree = await tree_of(root, hunks)
	const terms = prose_stale_scan.stale_terms(hunks, registered, tree)

	return await Promise.all(terms.map(async (term) => await reference_of(term, root)))
}

const prose_stale_read = { read_hunks, references }

export { prose_stale_read }
