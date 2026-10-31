import { mkdtempSync } from 'node:fs'
import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { import_graph, type ImportGraph } from '#scripts/lint/import-graph'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { test_pinned_reach } from './test-pinned-reach'
import { test_pinned_type_check } from './test-pinned-type-check'

const FILE = 'scripts/git/git-schemas.ts'
const READER = 'scripts/git/git-reader.ts'
const OTHER = 'scripts/git/git-other.ts'
const INFO = 'parent/josh-pinned.tsbuildinfo'

afterEach(() => {
	vi.restoreAllMocks()
	vi.unstubAllEnvs()
})

// A graph where only `READER` imports `FILE`.
function graph_stub(): ImportGraph {
	const target = path.resolve(FILE)

	return {
		imports: (file: string) => (file === path.resolve(READER) ? [target] : []),
	} as unknown as ImportGraph
}

describe('test_pinned_type_check.scope_of', () => {
	it('scopes a typed file to itself and its direct importers', async () => {
		vi.spyOn(import_graph, 'create').mockResolvedValue(graph_stub())
		vi.spyOn(test_pinned_reach, 'code_universe').mockResolvedValue(
			[FILE, READER, OTHER].map((file) => path.resolve(file)),
		)

		await expect(test_pinned_type_check.scope_of(FILE)).resolves.toStrictEqual([FILE, READER])
	})

	it('scopes a file TypeScript does not check to nothing, building no graph', async () => {
		const create = vi.spyOn(import_graph, 'create')

		await expect(test_pinned_type_check.scope_of('docs/guide.md')).resolves.toStrictEqual([])
		expect(create).not.toHaveBeenCalled()
	})

	it('scopes to nothing where no graph can be built', async () => {
		vi.spyOn(import_graph, 'create').mockResolvedValue(undefined)

		await expect(test_pinned_type_check.scope_of(FILE)).resolves.toStrictEqual([])
	})
})

describe('test_pinned_type_check.config_text', () => {
	it('extends the tree tsconfig, narrowed to the scope with its build info beside the tree', () => {
		const config: unknown = JSON.parse(test_pinned_type_check.config_text([FILE], INFO))

		expect(config).toStrictEqual({
			extends: './tsconfig.json',
			compilerOptions: {
				noUnusedLocals: false,
				noUnusedParameters: false,
				allowUnreachableCode: true,
				noEmit: true,
				incremental: true,
				tsBuildInfoFile: INFO,
			},
			include: [],
			files: [FILE],
		})
	})
})

describe('test_pinned_type_check.is_red', () => {
	it('reads an empty scope green without starting tsc', async () => {
		await expect(
			test_pinned_type_check.is_red({ parent: '/nowhere', tree: '/nowhere/tree' }, []),
		).resolves.toBe(false)
	})

	it('reads a tree with no tsc green, writing the scoped tsconfig into it', async () => {
		const parent = mkdtempSync(path.join(tmpdir(), 'josh-type-check-'))
		const tree = path.join(parent, 'tree')

		try {
			await mkdir(tree)

			await expect(test_pinned_type_check.is_red({ parent, tree }, [FILE])).resolves.toBe(false)

			const written = await readFile(path.join(tree, test_pinned_type_check.CONFIG_NAME), 'utf8')

			expect(written).toBe(
				test_pinned_type_check.config_text([FILE], path.join(parent, 'josh-pinned.tsbuildinfo')),
			)
		} finally {
			await rm(parent, { recursive: true, force: true })
		}
	})
})

// A tree whose tsconfig flags unused locals, with this checkout's tsc linked in.
async function strict_tree(parent: string): Promise<string> {
	const tree = path.join(parent, 'tree')
	const options = { strict: true, noUnusedLocals: true, noUnusedParameters: true }

	await mkdir(tree)
	await symlink(path.resolve('node_modules'), path.join(tree, 'node_modules'))
	await writeFile(path.join(tree, 'tsconfig.json'), JSON.stringify({ compilerOptions: options }))

	return tree
}

// joshuafolkken/kit#5385
describe('test_pinned_type_check.is_red with tsc', () => {
	it('reads a type error red and an unread local green', async () => {
		const parent = mkdtempSync(path.join(tmpdir(), 'josh-type-check-tsc-'))

		// joshuafolkken/kit#5505: a color-forcing environment, as a detached ship's gate, must not hide it.
		vi.stubEnv('FORCE_COLOR', '1')

		try {
			const tree = await strict_tree(parent)

			await writeFile(path.join(tree, 'unread.ts'), "const unread = 1\nexport const kept = 'x'\n")
			await writeFile(path.join(tree, 'wrong.ts'), "export const wrong: number = 'x'\n")

			await expect(test_pinned_type_check.is_red({ parent, tree }, ['unread.ts'])).resolves.toBe(
				false,
			)
			await expect(test_pinned_type_check.is_red({ parent, tree }, ['wrong.ts'])).resolves.toBe(
				true,
			)
		} finally {
			await rm(parent, { recursive: true, force: true })
		}
	})
})
