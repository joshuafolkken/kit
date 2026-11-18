import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { change_base } from '#scripts/git/change-base'
import { git_spawn } from '#scripts/git/git-spawn'
import { review_code_tree } from '#scripts/review/review-code-tree'
import { direct_importers } from './direct-importers'
import { test_pinned_reach, type ReachedCount } from './test-pinned-reach'
import { related_scope } from './test-related-scope'
import type { TypeScript } from './test-symbol-bindings'
import {
	test_symbol_select,
	type ChangedLines,
	type SymbolInput,
	type SymbolSelection,
} from './test-symbol-select'
import type { Source } from './test-symbol-users'

// **The work tree read for the symbol-level test selection** (joshuafolkken/kit#7980): every relatable
// source, the changed code files' lines since the change base, and the `package.json` import aliases.
// Without typescript or a change base it selects nothing, and `josh test:related` falls back to the
// import graph.

// The prefixes are pinned: a user's `diff.mnemonicPrefix` writes `+++ w/<file>`, read as no hunk.
const DIFF_ARGS = [
	'diff',
	'-U0',
	'--no-color',
	'--no-ext-diff',
	'--src-prefix=a/',
	'--dst-prefix=b/',
]

async function sources_of(root: string): Promise<Array<Source>> {
	const files = await direct_importers.work_tree_files(root)
	const readable = files.filter(
		(file) => related_scope.is_relatable(file) && existsSync(path.join(root, file)),
	)

	return readable.map((file) => ({ file, text: readFileSync(path.join(root, file), 'utf8') }))
}

async function diff_of(root: string, base: string, code: ReadonlyArray<string>): Promise<string> {
	if (code.length === 0) return ''

	return await git_spawn.read(['-C', root, ...DIFF_ARGS, base, '--', ...code])
}

async function input_of(
	root: string,
	typescript: TypeScript,
	code: ReadonlyArray<string>,
	lines: ChangedLines,
): Promise<SymbolInput> {
	return {
		typescript,
		sources: await sources_of(root),
		changed: code,
		lines,
		imports: direct_importers.source_reader(root).imports,
	}
}

// The tests `code`, root-relative changed code files, select by symbol; `undefined` where typescript or
// the change base is missing.
async function symbols(
	root: string,
	code: ReadonlyArray<string>,
): Promise<SymbolSelection | undefined> {
	const typescript = review_code_tree.load_typescript(root)
	const base = await change_base.resolved_through_merge()
	if (typescript === undefined || base === undefined) return undefined
	const diff = await diff_of(root, base, code)

	const lines = test_symbol_select.changed_lines(diff)

	return test_symbol_select.select_from(await input_of(root, typescript, code, lines))
}

function relative_of(root: string, file: string): string {
	return path.relative(root, path.resolve(root, file))
}

// Each of `files`' count of the tests a change to the whole file selects, `files` as given — what
// `josh test:related` would run for it, read before an edit (`lane:plan`'s hubs, `josh test:reach`).
// The import graph's count where typescript is missing.
async function reached_counts(
	files: ReadonlyArray<string>,
): Promise<Array<ReachedCount> | undefined> {
	const root = process.cwd()
	const typescript = review_code_tree.load_typescript(root)
	if (typescript === undefined) return await test_pinned_reach.reached_test_counts(files)
	const code = files.map((file) => relative_of(root, file))
	const input = await input_of(root, typescript, code, new Map())
	const counts = new Map(
		test_symbol_select.counts_from(input).map(({ file, count }) => [file, count]),
	)

	return files.map((file) => ({ file, count: counts.get(relative_of(root, file)) ?? 0 }))
}

const test_symbol_read = { reached_counts, symbols }

export { test_symbol_read }
