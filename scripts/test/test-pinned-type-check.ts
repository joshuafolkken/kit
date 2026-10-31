import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { BaseTree } from '#scripts/git/base-tree'
import { import_graph } from '#scripts/lint/import-graph'
import { execa } from 'execa'
import { test_pinned_reach } from './test-pinned-reach'

// The type-check stage of a `josh test:pinned` probe (joshuafolkken/kit#5385): a hunk its direct
// importers' tests leave green is type-checked with the hunk reverted before the whole reach runs. A
// change only the types pin — a key added to a loose schema, a constant added to a union — reads red
// here, so no full-reach probe runs for it.
//
// **The check is scoped to the file and its direct importers** through a throwaway tsconfig that
// extends the tree's own, never the whole project. Its build info lives beside the tree, so a lane's
// later hunks reuse it. The scope is checked before the revert too, and a red there answers nothing
// (`test-pinned-probe.ts`), so a red is the revert's alone — a tree whose types do not build without
// generated files, as a SvelteKit consumer's at HEAD, reads green. A file no graph reaches, or one
// TypeScript does not check, is scoped to nothing and reads green — the whole reach answers it as
// before.

const CONFIG_NAME = 'tsconfig.josh-pinned.json'
const BASE_CONFIG = './tsconfig.json'
const BUILD_INFO = 'josh-pinned.tsbuildinfo'
const TSC_BIN = path.join('node_modules', '.bin', 'tsc')
const TYPED_FILE = /\.[cm]?tsx?$/u
const TYPE_ERROR = /error TS\d+/u

// Off for the scoped check: a revert that leaves an import, local or parameter from another hunk
// unread, or code unreachable, is no type contract pinning the hunk, so it must not read red.
const LINT_OPTIONS_OFF = {
	noUnusedLocals: false,
	noUnusedParameters: false,
	allowUnreachableCode: true,
}

function is_typed(file: string): boolean {
	return TYPED_FILE.test(file)
}

// The file and each typed file of the work tree that imports it directly, relative to the work tree;
// empty where the file is not typed or no graph can be built.
async function scope_of(file: string): Promise<Array<string>> {
	if (!is_typed(file)) return []
	const graph = await import_graph.create(process.cwd())
	if (graph === undefined) return []
	const target = path.resolve(file)
	const universe = await test_pinned_reach.code_universe()
	const readers = universe.filter(
		(reader) => is_typed(reader) && graph.imports(reader).includes(target),
	)

	return [file, ...readers.map((reader) => path.relative(process.cwd(), reader))]
}

// The throwaway tsconfig: the tree's own, narrowed to `scope`, its build info at `build_info`.
function config_text(scope: ReadonlyArray<string>, build_info: string): string {
	const compiler_options = {
		...LINT_OPTIONS_OFF,
		noEmit: true,
		incremental: true,
		tsBuildInfoFile: build_info,
	}
	const config = {
		extends: BASE_CONFIG,
		compilerOptions: compiler_options,
		include: [],
		files: scope,
	}

	return `${JSON.stringify(config, undefined, '\t')}\n`
}

// Whether `scope` reads a type error in the tree as it stands. A tsc that cannot start reads no error.
// `--pretty false` keeps a color-forcing environment from splitting `TYPE_ERROR` with escape codes
// (joshuafolkken/kit#5505).
async function is_red(tree: BaseTree, scope: ReadonlyArray<string>): Promise<boolean> {
	if (scope.length === 0) return false
	const build_info = path.join(tree.parent, BUILD_INFO)

	await writeFile(path.join(tree.tree, CONFIG_NAME), config_text(scope, build_info))
	const result = await execa(
		path.join(tree.tree, TSC_BIN),
		['-p', CONFIG_NAME, '--pretty', 'false'],
		{
			cwd: tree.tree,
			reject: false,
			all: true,
		},
	)

	return TYPE_ERROR.test(result.all)
}

const test_pinned_type_check = { config_text, is_red, scope_of, CONFIG_NAME }

export { test_pinned_type_check }
