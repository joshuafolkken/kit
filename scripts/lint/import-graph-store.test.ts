import { execFileSync } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { describe, expect, it } from 'vitest'
import { import_graph } from './import-graph'
import { import_graph_store } from './import-graph-store'

// joshuafolkken/kit#7252: a file's resolved imports are kept across runs keyed by its content, and a
// run reads them back only while they still hold — the selection matches a graph built afresh.
const TSCONFIG = 'tsconfig.json'
const TSCONFIG_TEXT = JSON.stringify({
	compilerOptions: { module: 'esnext', moduleResolution: 'bundler' },
	include: ['**/*.ts'],
})
const PREFIX = 'kit-import-graph-store-'
const READER = 'reader.ts'
const OTHER = 'other.ts'
const A_FILE = 'a.ts'
const A_INDEX = 'a/index.ts'
const IMPORT_A = "import { a } from './a'\nexport const r = a\n"
const EXPORT_A = 'export const a = 1\n'
const STORED_A = `["${A_FILE}",false]`
const STORED_OTHER = `["${OTHER}",false]`
const WITH_OTHER = { [READER]: IMPORT_A, [A_FILE]: EXPORT_A, [OTHER]: EXPORT_A }
const MAPPED_TSCONFIG = JSON.stringify({
	compilerOptions: {
		module: 'esnext',
		moduleResolution: 'bundler',
		paths: { '#lib/*': ['./lib/*'] },
	},
	include: ['**/*.ts'],
})
const MAPPED_FILE = 'lib/b.ts'
const IMPORT_MAPPED = "import { a } from '#lib/b'\nexport const r = a\n"

const make_directory = temporary_directory()

function write(root: string, name: string, content: string): void {
	mkdirSync(path.dirname(path.join(root, name)), { recursive: true })
	writeFileSync(path.join(root, name), content)
}

function project(files: Record<string, string>): string {
	const root = realpathSync(make_directory(PREFIX))

	execFileSync('git', ['init', '--quiet'], { cwd: root })
	writeFileSync(path.join(root, TSCONFIG), TSCONFIG_TEXT)
	for (const [name, content] of Object.entries(files)) write(root, name, content)

	return root
}

function universe_of(root: string): Array<string> {
	return readdirSync(root, { recursive: true, encoding: 'utf8' })
		.filter((name) => name.endsWith('.ts') && !name.startsWith('.git'))
		.map((name) => path.join(root, name))
}

async function importers_of(root: string, file: string): Promise<Array<string>> {
	const graph = await import_graph.create(root)
	if (graph === undefined) throw new Error('expected a graph for a tsconfig project')
	const reached = graph.importers([path.join(root, file)], universe_of(root))

	return [...reached]
		.map((reader) => path.relative(root, reader))
		.toSorted((left, right) => left.localeCompare(right))
}

function store_file(root: string): string {
	const file_path = import_graph_store.store_path(root)
	if (file_path === undefined) throw new Error('expected a store inside a git repository')

	return file_path
}

// Rewrites the stored resolution of `reader.ts` to name `other.ts`, so a run that reads it is told apart
// from one that resolves afresh.
function forge_reader_entry(root: string): void {
	const file_path = store_file(root)
	const text = readFileSync(file_path, 'utf8')

	writeFileSync(file_path, text.split(STORED_A).join(STORED_OTHER))
}

describe('import_graph_store — a stored resolution is read back', () => {
	it('reads the stored resolution of a file whose content has not moved', async () => {
		const root = project(WITH_OTHER)

		expect(await importers_of(root, OTHER)).toStrictEqual([OTHER])
		forge_reader_entry(root)

		expect(await importers_of(root, OTHER)).toStrictEqual([OTHER, READER])
	})

	it('keeps nothing outside a git repository', () => {
		const root = realpathSync(make_directory(PREFIX))

		expect(import_graph_store.store_path(root)).toBeUndefined()
	})
})

describe('import_graph_store — a resolution that no longer holds is resolved afresh', () => {
	it('resolves a file whose content moved', async () => {
		const root = project(WITH_OTHER)

		await importers_of(root, OTHER)
		forge_reader_entry(root)
		write(root, READER, `${IMPORT_A}// moved\n`)

		expect(await importers_of(root, OTHER)).toStrictEqual([OTHER])
	})

	it('resolves afresh under another compiler configuration', async () => {
		const root = project(WITH_OTHER)

		await importers_of(root, OTHER)
		forge_reader_entry(root)
		write(root, TSCONFIG, `${TSCONFIG_TEXT}\n`)

		expect(await importers_of(root, OTHER)).toStrictEqual([OTHER])
	})

	it('follows an import to the new file that now answers it', async () => {
		const root = project({ [READER]: IMPORT_A, [A_INDEX]: EXPORT_A })

		expect(await importers_of(root, A_INDEX)).toStrictEqual([A_INDEX, READER])
		write(root, A_FILE, EXPORT_A)

		expect(await importers_of(root, A_FILE)).toStrictEqual([A_FILE, READER])
	})

	it('follows an import past a deleted file to the one that answers it now', async () => {
		const root = project({ [READER]: IMPORT_A, [A_FILE]: EXPORT_A, [A_INDEX]: EXPORT_A })

		expect(await importers_of(root, A_FILE)).toStrictEqual([A_FILE, READER])
		rmSync(path.join(root, A_FILE))

		expect(await importers_of(root, A_INDEX)).toStrictEqual([A_INDEX, READER])
	})
})

describe('import_graph_store — an import that resolved to nothing', () => {
	it('follows a mapped import that resolved to nothing to the file created since', async () => {
		const root = project({
			[TSCONFIG]: MAPPED_TSCONFIG,
			[READER]: IMPORT_MAPPED,
			[OTHER]: EXPORT_A,
		})

		expect(await importers_of(root, OTHER)).toStrictEqual([OTHER])
		write(root, MAPPED_FILE, EXPORT_A)

		expect(await importers_of(root, MAPPED_FILE)).toStrictEqual([MAPPED_FILE, READER])
	})
})
