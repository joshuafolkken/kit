import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execaSync } from 'execa'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const ROOT = process.cwd()
const SCRATCH = mkdtempSync(path.join(os.tmpdir(), 'kit-optional-eslint-'))
const PNPM = 'pnpm'
const DIR_FLAG = '--dir'
const IGNORE_SCRIPTS_FLAG = '--ignore-scripts'
const MANIFEST = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
	version: string
	devDependencies: Record<string, string>
	peerDependencies: Record<string, string>
	peerDependenciesMeta: Record<string, { optional: boolean }>
}
const ESLINT_PACKAGES = Object.keys(MANIFEST.peerDependencies).filter((name) =>
	/^(?:@eslint\/|@stylistic\/|eslint|globals$|typescript)/u.test(name),
)
const LINT_PROBE = `import { create_vanilla_config } from '@joshuafolkken/kit/eslint/vanilla'
import { ESLint } from 'eslint'
const config = create_vanilla_config({ gitignore_path: new URL('./.gitignore', import.meta.url), tsconfig_root_dir: process.cwd() })
const lint = new ESLint({ cwd: process.cwd(), overrideConfigFile: true, overrideConfig: config })
const [result] = await lint.lintText('var foo = 1', { filePath: 'probe.js' })
if (result.fatalErrorCount !== 0 || !result.messages.some((message) => message.ruleId === 'no-var')) process.exit(1)
`
const SVELTE_PROBE = [
	"import { config } from '@joshuafolkken/kit/prettier'",
	"import { format } from 'prettier'",
	"const output = await format('<script>let answer=1</script><h1>{answer}</h1>', { ...config, parser: 'svelte' })",
	'console.log(output)',
].join('\n')
const TARBALL = path.join(SCRATCH, `joshuafolkken-kit-${MANIFEST.version}.tgz`)

function add_packages(directory: string, packages: ReadonlyArray<string>): void {
	mkdirSync(directory, { recursive: true })
	execaSync(PNPM, ['add', DIR_FLAG, directory, '--offline', IGNORE_SCRIPTS_FLAG, ...packages], {
		cwd: ROOT,
	})
}

function installed_names(directory: string): Set<string> {
	const { stdout } = execaSync(PNPM, ['list', DIR_FLAG, directory, '--depth', 'Infinity', '--json'])
	const names = new Set<string>()
	const [project] = JSON.parse(stdout) as Array<{ dependencies: Record<string, unknown> }>
	if (project === undefined) throw new Error('pnpm returned no project dependency tree')

	function collect(dependencies: Record<string, unknown>): void {
		for (const [name, entry] of Object.entries(dependencies)) {
			names.add(name)
			const child = entry as { dependencies?: Record<string, unknown> }
			if (child.dependencies) collect(child.dependencies)
		}
	}

	collect(project.dependencies)

	return names
}

function package_spec(name: string): string {
	const version = MANIFEST.devDependencies[name]
	if (version === undefined) throw new Error(`Missing development version for ${name}`)

	return `${name}@${version}`
}

beforeAll(() => {
	const { stdout } = execaSync(
		PNPM,
		['pack', IGNORE_SCRIPTS_FLAG, '--pack-destination', SCRATCH, '--json'],
		{
			cwd: ROOT,
		},
	)

	const { filename } = JSON.parse(stdout) as { filename: string }

	expect(path.resolve(SCRATCH, filename)).toBe(TARBALL)
})

afterAll(() => {
	rmSync(SCRATCH, { recursive: true, force: true })
})

vi.setConfig({ testTimeout: 60_000 })

describe('published kit optional ESLint installation', () => {
	it('keeps ESLint and Svelte out of a minimal installation', () => {
		const directory = path.join(SCRATCH, 'minimal')

		add_packages(directory, [TARBALL])
		const names = installed_names(directory)

		expect([...names].filter((name) => /eslint|svelte/u.test(name))).toEqual([])
	})

	it('resolves the public config against an opted-in consumer and runs ESLint', () => {
		const directory = path.join(SCRATCH, 'eslint')
		const peers = ESLINT_PACKAGES.map((name) => package_spec(name))

		add_packages(directory, [TARBALL, ...peers])
		writeFileSync(path.join(directory, '.gitignore'), '')
		const config_path = path.join(directory, 'lint-probe.mjs')

		writeFileSync(config_path, LINT_PROBE)
		execaSync(process.execPath, [config_path], { cwd: directory })
		expect(ESLINT_PACKAGES.every((name) => MANIFEST.peerDependenciesMeta[name]?.optional)).toBe(
			true,
		)
	})

	it('formats Svelte when its plugin and peer are explicitly installed', () => {
		const directory = path.join(SCRATCH, 'svelte')
		const packages = [
			'prettier@^3.9.9',
			'@ianvs/prettier-plugin-sort-imports@^4.7.1',
			'prettier-plugin-tailwindcss@^0.8.1',
			'prettier-plugin-svelte@^4.1.1',
			'svelte@^5.55.7',
		]

		add_packages(directory, [TARBALL, ...packages])
		const probe_path = path.join(directory, 'svelte-probe.mjs')

		writeFileSync(probe_path, SVELTE_PROBE)
		const { stdout } = execaSync(process.execPath, [probe_path], { cwd: directory })

		expect(stdout).toContain('<h1>{answer}</h1>')
	})
})
