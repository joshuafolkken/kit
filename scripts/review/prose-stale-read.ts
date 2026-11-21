import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { git_grep_hits, type Hit } from '#scripts/git/git-grep-hits'
import { git_spawn } from '#scripts/git/git-spawn'
import { COMMAND_MAP } from '#scripts/josh/josh-command-map'
import { test_pinned_logic, type Hunk } from '#scripts/test/test-pinned-logic'
import { prose_stale_scan, type Reference, type Term, type Tree } from './prose-stale-scan'
import { prose_stale_values } from './prose-stale-values'
import { review_readers_scan } from './review-readers-scan'

// The git half of `josh prose:stale`: the diff from the change base to the working tree, and the
// search for each word it removed. Its own module, without a main guard, so `josh review:selfcheck`
// (joshuafolkken/kit#5540) imports it as well as `prose-stale-cli.ts`.

// The history files — `CHANGELOG.md` and the observation ledgers — keep the names they recorded, so
// neither is prose to update (joshuafolkken/kit#8048).
const SEARCH_PATHS = [
	'*.md',
	'prompts',
	'docs',
	'.claude',
	'scripts',
	':(exclude)CHANGELOG.md',
	':(exclude).josh/observations',
]
// The code files a live declaration is looked for in, at any depth; a test file names nothing.
const CODE_PATHSPECS = ['*.ts', '*.js', ':(exclude)*.test.ts', ':(exclude)*.test.js']

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

// `git grep` still C-quotes a path holding `"`, `\` or a control character, which names no file to
// read; such a hit keeps its excerpt.
async function source_of(root: string, file: string): Promise<string | undefined> {
	try {
		return await readFile(path.join(root, file), 'utf8')
	} catch {
		return undefined
	}
}

async function lines_of(root: string, file: string): Promise<[string, Array<string>]> {
	const source = await source_of(root, file)

	return [file, source?.split('\n') ?? []]
}

// A hit's excerpt is cut short; a value or flag is judged by its whole line, where the constant's
// words may sit past the cut.
async function whole_lines(root: string, hits: ReadonlyArray<Hit>): Promise<Array<Hit>> {
	const files = [...new Set(hits.map((hit) => hit.path))]
	const lines = new Map(await Promise.all(files.map(async (file) => await lines_of(root, file))))

	return hits.map((hit) => ({
		...hit,
		excerpt: lines.get(hit.path)?.[Number(hit.line) - 1] ?? hit.excerpt,
	}))
}

async function reference_of(term: Term, root: string): Promise<Reference> {
	const { target, flags } = prose_stale_scan.pattern(term)
	const { hits, has_failed } = await git_grep_hits.search(target, flags, SEARCH_PATHS, root)
	const read = prose_stale_scan.VALUE_KINDS.has(term.kind) ? await whole_lines(root, hits) : hits

	return { term, hits: read, has_failed }
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

// The names a code hunk's removed lines declare: a deleted file's reachable ones, a kept file's every one.
function removed_names(hunk: Hunk, deleted: ReadonlyArray<string>): Array<string> {
	const source = hunk.old_lines.join('\n')

	if (deleted.includes(hunk.file)) return review_readers_scan.reachable_names(source)

	return review_readers_scan.declarations(source).map(({ name }) => name)
}

// A removed name a live module outside the change still declares names that module, not the removed
// one: a deleted namespace's `record` beside `gate-ledger.ts`'s (joshuafolkken/kit#7048), a renamed
// private `is_running` beside `backlog-waves.ts`'s (joshuafolkken/kit#7725).
async function declared_elsewhere(
	root: string,
	hunks: ReadonlyArray<Hunk>,
	deleted: ReadonlyArray<string>,
): Promise<Array<string>> {
	const code = hunks.filter((hunk) => prose_stale_scan.CODE_FILE.test(hunk.file))
	const names = [...new Set(code.flatMap((hunk) => removed_names(hunk, deleted)))]
	const declared = new Set(await declared_in(root, await files_writing(root, names)))

	return names.filter((name) => declared.has(name))
}

// A removed flag a code line of the working tree still writes is live — another command's, or the
// same one moved (joshuafolkken/kit#7881); a comment line writing it is prose, not a use, and a longer
// flag it begins (`--period-days` for `--period`) is another flag, which `git grep -w` would match.
async function is_live(root: string, flag: string): Promise<boolean> {
	const { hits } = await git_grep_hits.search(flag, ['-F'], CODE_PATHSPECS, root)
	const read = await whole_lines(root, hits)

	return read.some(
		(hit) => !prose_stale_scan.is_prose(hit) && prose_stale_values.is_use({ word: flag }, hit),
	)
}

async function live_flags(root: string, hunks: ReadonlyArray<Hunk>): Promise<Array<string>> {
	const code = hunks.filter((hunk) => prose_stale_scan.is_code_hunk(hunk))
	const flags = [...new Set(code.flatMap((hunk) => prose_stale_values.flags(hunk.old_lines)))]
	const live = await Promise.all(flags.map(async (flag) => await is_live(root, flag)))

	return flags.filter((_flag, index) => live[index] === true)
}

// The names the change's code files declare in the working tree, an unchanged line included
// (joshuafolkken/kit#6077), and the files it deleted, which declare none (joshuafolkken/kit#6130).
async function tree_of(root: string, hunks: ReadonlyArray<Hunk>): Promise<Tree> {
	const files = [...new Set(hunks.map((hunk) => hunk.file))].filter((file) =>
		prose_stale_scan.CODE_FILE.test(file),
	)
	const present = files.filter((file) => existsSync(path.join(root, file)))
	const names = await declared_in(root, present)
	const deleted = files.filter((file) => !present.includes(file))
	const elsewhere = await declared_elsewhere(root, hunks, deleted)
	const flags = await live_flags(root, hunks)

	return { surviving: new Set([...names, ...elsewhere, ...flags]), deleted: new Set(deleted) }
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
