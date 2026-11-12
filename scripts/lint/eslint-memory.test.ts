import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, symlinkSync } from 'node:fs'
import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { build } from 'esbuild'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { eslint_heap } from './eslint-heap'
import { eslint_memory } from './eslint-memory.js'

const make_directory = temporary_directory()
const MEMORY_LINE = /ESLint peak RSS: (?<mib>\d+\.\d) MiB/gu
const ROOT = process.cwd()
const MANIFEST = 'package.json'
const MEMORY_SOURCE = 'scripts/lint/eslint-memory.js'
const BUNDLE_ENTRY = `
import { eslint_heap } from './scripts/lint/eslint-heap.ts'
const result = await eslint_heap.run_cold(['exec', 'eslint', '--version'])
process.stdout.write(result.output)
process.exitCode = result.exit_code ?? 1
`

function package_fixture(): string {
	const root = make_directory('eslint-memory bundle-')
	const directory = path.join(root, 'node_modules', 'kit')

	mkdirSync(path.join(directory, 'scripts', 'lint'), { recursive: true })
	copyFileSync(path.join(ROOT, MANIFEST), path.join(directory, MANIFEST))
	copyFileSync(path.join(ROOT, MEMORY_SOURCE), path.join(directory, MEMORY_SOURCE))
	symlinkSync(path.join(ROOT, 'node_modules'), path.join(directory, 'node_modules'), 'dir')

	return directory
}

async function bundled_output(): Promise<string> {
	const outfile = path.join(package_fixture(), 'dist', 'probe.mjs')

	await build({
		stdin: { contents: BUNDLE_ENTRY, resolveDir: ROOT, sourcefile: 'probe.ts' },
		outfile,
		bundle: true,
		platform: 'node',
		format: 'esm',
		packages: 'external',
	})

	return execFileSync(process.execPath, [outfile], { encoding: 'utf8' })
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe('ESLint peak memory', () => {
	it('writes the operating system peak RSS as MiB', () => {
		expect(eslint_memory.peak_mib('1048576 maximum resident set size', 'darwin')).toBe(1)
		expect(eslint_memory.peak_mib('JOSH_ESLINT_RSS=1024', 'linux')).toBe(1)
	})

	it('loads the shipped preload from an installed bundled command with spaces in its path', async () => {
		const output = await bundled_output()

		expect([...output.matchAll(MEMORY_LINE)]).toHaveLength(1)
	})

	it('reports the ESLint child peak once on success', async () => {
		const result = await eslint_heap.run_cold(['exec', 'eslint', '--version'])
		const lines = [...result.output.matchAll(MEMORY_LINE)]

		expect(result.exit_code).toBe(0)
		expect(lines).toHaveLength(1)
		expect(Number(lines[0]?.groups?.['mib'])).toBeGreaterThan(0)
	})

	it('reports peak memory and preserves a failing CLI exit', async () => {
		const result = await eslint_heap.run_cold(['exec', 'eslint', '--invalid-memory-test-option'])

		expect(result.exit_code).not.toBe(0)
		expect([...result.output.matchAll(MEMORY_LINE)]).toHaveLength(1)
	})

	it('reports peak memory after a real ESLint heap abort', async () => {
		vi.stubEnv('NODE_OPTIONS', '--max-old-space-size=16')
		onTestFinished(() => {
			vi.unstubAllEnvs()
		})

		const result = await eslint_heap.run_cold(['exec', 'eslint', MEMORY_SOURCE, '--no-cache'])

		expect(result.exit_code).not.toBe(0)
		expect(result.output).toContain('heap out of memory')
		expect([...result.output.matchAll(MEMORY_LINE)]).toHaveLength(1)
	})
})
