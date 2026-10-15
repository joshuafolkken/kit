import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PACK_HOOK_FILE } from '#scripts/safe-chain/pack-hook'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Same import-time paths as the other `init` integration tests, so the same getter mock
// (joshuafolkken/kit#879).
const paths_mock = vi.hoisted(() => ({ root: '', package_dir: '' }))

vi.mock('./init-paths', () => ({
	get PROJECT_ROOT(): string {
		return paths_mock.root
	},
	get PACKAGE_DIR(): string {
		return paths_mock.package_dir
	},
	package_path: (relative_path: string): string => path.join(paths_mock.package_dir, relative_path),
}))
vi.mock('execa', () => ({ execaSync: vi.fn() }))

const PACKAGE_JSON = 'package.json'
const PRETTIER_DEPENDENCY = '"prettier"'
const PRETTIER_FILES = [
	'prettier.config.mjs',
	'.prettierignore',
	path.join('.vscode', 'settings.json'),
]

async function run_init(): Promise<void> {
	const { main } = await import('./init')

	main(['--no-install'])
}

function write_project_file(name: string, content: string): void {
	writeFileSync(path.join(paths_mock.root, name), content)
}

// Every file under the project with its content — what a rerun must leave exactly as it was.
function project_snapshot(): Record<string, string> {
	const files = readdirSync(paths_mock.root, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile())
		.map((entry) => path.join(entry.parentPath, entry.name))

	return Object.fromEntries(
		files.map((file) => [path.relative(paths_mock.root, file), readFileSync(file, 'utf8')]),
	)
}

async function snapshot_two_runs(): Promise<{
	first: Record<string, string>
	second: Record<string, string>
}> {
	await run_init()
	const first = project_snapshot()

	vi.resetModules()
	await run_init()

	return { first, second: project_snapshot() }
}

beforeEach(() => {
	vi.resetModules()
	paths_mock.package_dir = fileURLToPath(new URL('../../', import.meta.url))
	paths_mock.root = mkdtempSync(path.join(os.tmpdir(), 'josh-init-rerun-'))
	// A published manifest is what makes `init` write its pack hook, the `.mjs` file of kit's own.
	write_project_file(PACKAGE_JSON, '{"name":"example"}\n')
	write_project_file('main.lua', 'print("hello")\n')
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
})

afterEach(() => {
	rmSync(paths_mock.root, { recursive: true, force: true })
	vi.restoreAllMocks()
})

describe('a second josh init in a project without Web files (#3713)', () => {
	it('changes no file when the only Web file is the pack hook kit wrote', async () => {
		const { first, second } = await snapshot_two_runs()

		expect(first).toHaveProperty([PACK_HOOK_FILE])
		expect(second).toStrictEqual(first)
	})

	it('never adds Prettier or its files', async () => {
		const { second } = await snapshot_two_runs()

		for (const file of PRETTIER_FILES) expect(second).not.toHaveProperty([file])
		expect(second[PACKAGE_JSON]).not.toContain(PRETTIER_DEPENDENCY)
	})

	it('still adds Prettier once the user adds a module file of their own', async () => {
		write_project_file('app.mjs', 'export {}\n')
		const { first } = await snapshot_two_runs()

		for (const file of PRETTIER_FILES) expect(first).toHaveProperty([file])
		expect(first[PACKAGE_JSON]).toContain(PRETTIER_DEPENDENCY)
	})
})

describe('josh init in a project with a formatter of its own (#3832)', () => {
	it('adds no Prettier or its files beside a biome.json, on the first run and the second', async () => {
		write_project_file('index.html', '<h1>Hello</h1>\n')
		write_project_file('biome.json', '{}\n')
		const { first, second } = await snapshot_two_runs()

		for (const snapshot of [first, second]) {
			for (const file of PRETTIER_FILES) expect(snapshot).not.toHaveProperty([file])
			expect(snapshot[PACKAGE_JSON]).not.toContain(PRETTIER_DEPENDENCY)
		}
	})
})
