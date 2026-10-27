import {
	mkdirSync,
	mkdtempSync,
	realpathSync,
	renameSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { import_graph, type ImportGraph } from './import-graph'

// joshuafolkken/kit#4415: what a cached lint verdict read besides its own file. Each case writes a
// small tsconfig project and asks the hash again after one file in it changes.
type ProjectFile = readonly [string, string]

const TSCONFIG_NAME = 'tsconfig.json'

function tsconfig_with(compiler_options: Record<string, unknown>): ProjectFile {
	return [
		TSCONFIG_NAME,
		JSON.stringify({
			compilerOptions: {
				module: 'esnext',
				moduleResolution: 'bundler',
				strict: true,
				...compiler_options,
			},
			include: ['*.ts'],
		}),
	]
}

const TSCONFIG_FILE = tsconfig_with({})
const TOP = 'top.ts'
const UNRELATED = 'unrelated.ts'
const UNRELATED_FILE: ProjectFile = [UNRELATED, 'export const unrelated = 1\n']
const TOP_SOURCE = "import { middle } from './middle'\n\nexport const top = middle\n"
const CHAIN: ReadonlyArray<ProjectFile> = [
	[TOP, TOP_SOURCE],
	['middle.ts', "import { bottom } from './bottom'\n\nexport const middle = bottom\n"],
	['bottom.ts', 'export const bottom = 1\n'],
	UNRELATED_FILE,
	TSCONFIG_FILE,
]
const RIGHT = 'right.ts'
const RIGHT_SOURCE = "import { left } from './left'\n\nexport const right = 1\n"
const PACKAGE_NAME = 'fake-package'
const PACKAGE_TYPES_FILE = 'index.d.ts'
const PACKAGE_DIRECTORY = path.join('node_modules', PACKAGE_NAME)
const PACKAGE_TYPES = path.join(PACKAGE_DIRECTORY, PACKAGE_TYPES_FILE)
const LINKED_DIRECTORY = 'linked-package'
const PACKAGE_USER = 'uses-package.ts'
const USED_NUMBER = 'export declare const used: number\n'
const USED_ANY = 'export declare const used: any\n'

const roots: Array<string> = []

function write_project(files: ReadonlyArray<readonly [string, string]>): string {
	const created = mkdtempSync(path.join(tmpdir(), 'kit-import-graph-'))
	const root = realpathSync(created)

	roots.push(root)
	for (const [name, content] of files) writeFileSync(path.join(root, name), content)

	return root
}

async function graph_of(root: string): Promise<ImportGraph> {
	const graph = await import_graph.create(root)
	if (graph === undefined) throw new Error('expected a graph for a tsconfig project')

	return graph
}

// A fresh graph per question: one graph keeps the contents it read for its lifetime, as one run does.
async function hash_of(root: string, file: string): Promise<string> {
	const graph = await graph_of(root)

	return graph.closure_hash(path.join(root, file))
}

function write_package(root: string, types: string): void {
	mkdirSync(path.join(root, PACKAGE_DIRECTORY), { recursive: true })
	writeFileSync(
		path.join(root, PACKAGE_DIRECTORY, 'package.json'),
		JSON.stringify({ name: PACKAGE_NAME, types: PACKAGE_TYPES_FILE }),
	)
	writeFileSync(path.join(root, PACKAGE_TYPES), types)
}

// A project importing the package, with the package installed under node_modules.
function write_package_user(): string {
	const root = write_project([
		[PACKAGE_USER, `import { used } from '${PACKAGE_NAME}'\n\nexport const copy = used\n`],
		TSCONFIG_FILE,
	])

	write_package(root, USED_NUMBER)

	return root
}

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('import_graph.closure_hash', () => {
	it('changes when a file two imports away changes', async () => {
		const root = write_project(CHAIN)
		const before = await hash_of(root, TOP)

		writeFileSync(path.join(root, 'bottom.ts'), 'export const bottom = JSON.parse("1")\n')

		expect(await hash_of(root, TOP)).not.toBe(before)
	})

	it('stays the same when the file itself or one it does not import changes', async () => {
		const root = write_project(CHAIN)
		const before = await hash_of(root, TOP)

		writeFileSync(path.join(root, TOP), `${TOP_SOURCE}// edited\n`)
		writeFileSync(path.join(root, UNRELATED), 'export const unrelated = 2\n')

		expect(await hash_of(root, TOP)).toBe(before)
	})

	it('ends on an import cycle and still follows its other side', async () => {
		const root = write_project([
			['left.ts', "import { right } from './right'\n\nexport const left = right\n"],
			[RIGHT, RIGHT_SOURCE],
			TSCONFIG_FILE,
		])
		const before = await hash_of(root, 'left.ts')

		writeFileSync(path.join(root, RIGHT), RIGHT_SOURCE.replace('1', '2'))

		expect(await hash_of(root, 'left.ts')).not.toBe(before)
	})

	// A lane's seed rebases the cache file into another checkout, whose files sit under another root.
	it('is the same for the same project checked out under another root', async () => {
		const first = write_project(CHAIN)
		const second = write_project(CHAIN)

		expect(await hash_of(second, TOP)).toBe(await hash_of(first, TOP))
	})
})

describe('import_graph.closure', () => {
	it("names the project's files the imports reach, without the file itself or a package's", async () => {
		const root = write_package_user()

		for (const [name, content] of CHAIN) writeFileSync(path.join(root, name), content)
		writeFileSync(path.join(root, TOP), `${TOP_SOURCE}import './${PACKAGE_USER}'\n`)
		const graph = await graph_of(root)
		const reached = graph.closure(path.join(root, TOP))

		expect(reached.toSorted((left, right) => left.localeCompare(right))).toEqual(
			['bottom.ts', 'middle.ts', TSCONFIG_NAME, PACKAGE_USER].map((file) => path.join(root, file)),
		)
	})
})

describe('import_graph.strings', () => {
	it("reads each string literal and template span, a comment's text left out", async () => {
		const source = "// runs comment.ts\nimport './a'\nspawn('cli.ts', [`${dir}/main.ts`, `x.ts`])\n"
		const root = write_project([[TOP, source], TSCONFIG_FILE])
		const graph = await graph_of(root)

		expect(graph.strings(path.join(root, TOP))).toEqual(['./a', 'cli.ts', '', '/main.ts', 'x.ts'])
	})
})

describe('import_graph.closure_hash — a package import', () => {
	// The resolved path carries the installed version, so the package's content is never read.
	it('names a package import by where it resolves rather than by its content', async () => {
		const root = write_package_user()
		const before = await hash_of(root, PACKAGE_USER)

		writeFileSync(path.join(root, PACKAGE_TYPES), USED_ANY)

		expect(await hash_of(root, PACKAGE_USER)).toBe(before)
	})

	// A workspace or `link:` package resolves through its symlink to source outside the install.
	it('reads a linked package whose real path sits outside node_modules', async () => {
		const root = write_package_user()

		renameSync(path.join(root, PACKAGE_DIRECTORY), path.join(root, LINKED_DIRECTORY))
		symlinkSync(path.join(root, LINKED_DIRECTORY), path.join(root, PACKAGE_DIRECTORY))
		const before = await hash_of(root, PACKAGE_USER)

		writeFileSync(path.join(root, LINKED_DIRECTORY, PACKAGE_TYPES_FILE), USED_ANY)

		expect(await hash_of(root, PACKAGE_USER)).not.toBe(before)
	})
})

// What a file reads without importing it: SvelteKit's `src/app.d.ts` `App.Locals`, a reference
// directive, the `types` packages, a `.svelte` component the checker cannot resolve.
const GLOBALS = 'globals.d.ts'
const GLOBALS_SOURCE =
	'declare global {\n\tinterface Locals {\n\t\tuser: string\n\t}\n}\n\nexport {}\n'
const LOCALS_USER = 'hooks.ts'
const LOCALS_USER_SOURCE =
	'export function user_of(locals: Locals): string {\n\treturn locals.user\n}\n'
const EXPORTED = 'exported.d.ts'
const REFERENCED = 'referenced.d.ts'
const WIDGET = 'widget.svelte'
const BASE_CONFIG_NAME = 'base.json'
const BASE_CONFIG = JSON.stringify({ compilerOptions: { strict: true } })

// The hash of `file` before and after `edit` is written over one of the project's files.
async function hashes_around(
	files: ReadonlyArray<ProjectFile>,
	file: string,
	edit: ProjectFile,
): Promise<readonly [string, string]> {
	const root = write_project([...files, TSCONFIG_FILE])
	const before = await hash_of(root, file)

	writeFileSync(path.join(root, edit[0]), edit[1])

	return [before, await hash_of(root, file)]
}

// joshuafolkken/kit#4420: `strict` decides what a type-aware rule reads as `any`, so the options are
// read like an import.
describe('import_graph.closure_hash — the compiler options', () => {
	it('changes when the compiler options in tsconfig.json change', async () => {
		const [before, after] = await hashes_around(
			[UNRELATED_FILE],
			UNRELATED,
			tsconfig_with({ strict: false }),
		)

		expect(after).not.toBe(before)
	})

	it('changes when a configuration file tsconfig.json extends changes', async () => {
		const extending: ProjectFile = [
			TSCONFIG_NAME,
			JSON.stringify({ extends: `./${BASE_CONFIG_NAME}`, include: ['*.ts'] }),
		]
		const root = write_project([UNRELATED_FILE, extending, [BASE_CONFIG_NAME, BASE_CONFIG]])
		const before = await hash_of(root, UNRELATED)

		writeFileSync(path.join(root, BASE_CONFIG_NAME), BASE_CONFIG.replace('true', 'false'))

		expect(await hash_of(root, UNRELATED)).not.toBe(before)
	})
})

describe('import_graph.closure_hash — what a file reads without importing it', () => {
	it('changes when an ambient declaration the project includes changes', async () => {
		const [before, after] = await hashes_around(
			[
				[GLOBALS, GLOBALS_SOURCE],
				[LOCALS_USER, LOCALS_USER_SOURCE],
			],
			LOCALS_USER,
			[GLOBALS, GLOBALS_SOURCE.replace('string', 'any')],
		)

		expect(after).not.toBe(before)
	})

	it('stays the same when an unimported declaration file that only exports changes', async () => {
		const [before, after] = await hashes_around(
			[[EXPORTED, 'export type Exported = number\n'], UNRELATED_FILE],
			UNRELATED,
			[EXPORTED, 'export type Exported = any\n'],
		)

		expect(after).toBe(before)
	})

	it('names the type packages the compiler options load', async () => {
		const without = write_project([UNRELATED_FILE, tsconfig_with({ types: [] })])
		const with_types = write_project([UNRELATED_FILE, tsconfig_with({ types: [PACKAGE_NAME] })])

		write_package(with_types, USED_NUMBER)

		expect(await hash_of(with_types, UNRELATED)).not.toBe(await hash_of(without, UNRELATED))
	})
})

describe('import_graph.closure_hash — a global augmentation outside a declaration file', () => {
	it('changes when a global augmentation in a .ts module the project includes changes', async () => {
		const augmentation = 'augmentation.ts'
		const [before, after] = await hashes_around(
			[
				[augmentation, GLOBALS_SOURCE],
				[LOCALS_USER, LOCALS_USER_SOURCE],
			],
			LOCALS_USER,
			[augmentation, GLOBALS_SOURCE.replace('string', 'any')],
		)

		expect(after).not.toBe(before)
	})
})

describe('import_graph.closure_hash — a file named but not resolved as a module', () => {
	it('changes when a file a reference directive names changes', async () => {
		const [before, after] = await hashes_around(
			[
				[REFERENCED, 'export type Referenced = number\n'],
				[TOP, `/// <reference path="./${REFERENCED}" />\nexport const top = 1\n`],
			],
			TOP,
			[REFERENCED, 'export type Referenced = any\n'],
		)

		expect(after).not.toBe(before)
	})

	it('changes when a relative import the checker cannot resolve changes', async () => {
		const [before, after] = await hashes_around(
			[
				[WIDGET, '<p>one</p>\n'],
				[TOP, `import Widget from './${WIDGET}'\n\nexport const top = Widget\n`],
			],
			TOP,
			[WIDGET, '<p>two</p>\n'],
		)

		expect(after).not.toBe(before)
	})
})

describe('import_graph.imports', () => {
	it('names only the files a file imports directly, not the ones they import', async () => {
		const root = write_project(CHAIN)
		const graph = await graph_of(root)

		expect(graph.imports(path.join(root, TOP))).toStrictEqual([path.join(root, 'middle.ts')])
	})

	it('reads another text of the file in its place, resolved from where the file sits', async () => {
		const root = write_project(CHAIN)
		const graph = await graph_of(root)
		const text = "import { bottom } from './bottom'\n"

		expect(graph.imports(path.join(root, TOP), text)).toStrictEqual([path.join(root, 'bottom.ts')])
	})

	it("leaves out an installed package's files", async () => {
		const root = write_package_user()
		const graph = await graph_of(root)

		expect(graph.imports(path.join(root, PACKAGE_USER))).toStrictEqual([])
	})
})

describe('import_graph.create', () => {
	it('answers undefined for a project with no tsconfig.json', async () => {
		const root = write_project([['only.ts', 'export const only = 1\n']])

		expect(await import_graph.create(root)).toBeUndefined()
	})
})
