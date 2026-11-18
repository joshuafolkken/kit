import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { change_base } from '#scripts/git/change-base'
import { git_spawn } from '#scripts/git/git-spawn'
import { review_code_tree } from '#scripts/review/review-code-tree'
import { direct_importers } from './direct-importers'
import { related_scope } from './test-related-scope'
import { test_symbol_select, type SymbolSelection } from './test-symbol-select'
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

	return test_symbol_select.select_from({
		typescript,
		sources: await sources_of(root),
		changed: code,
		lines: test_symbol_select.changed_lines(diff),
		imports: direct_importers.source_reader(root).imports,
	})
}

const test_symbol_read = { symbols }

export { test_symbol_read }
