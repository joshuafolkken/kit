import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

interface PackageJson {
	files?: Array<string>
	bin?: Record<string, string>
	exports?: Record<string, unknown>
	pnpm?: {
		overrides?: Record<string, string>
		// eslint-disable-next-line @typescript-eslint/naming-convention
		onlyBuiltDependencies?: Array<string>
	}
	scripts?: Record<string, string>
}

function load_manifest(): PackageJson {
	const content = readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8')

	return JSON.parse(content) as PackageJson
}

function extract_top_directory(file_path: string): string {
	return file_path.replace(/^\.\//u, '').split('/')[0] ?? ''
}

function extract_string_paths(value: unknown): Array<string> {
	if (typeof value === 'string') return [value]
	if (value === null || typeof value !== 'object') return []

	return Object.values(value as Record<string, unknown>).filter(
		(nested): nested is string => typeof nested === 'string',
	)
}

function collect_export_directories(exports_map: Record<string, unknown>): Array<string> {
	const directories = new Set<string>()

	for (const value of Object.values(exports_map)) {
		for (const file_path of extract_string_paths(value)) {
			directories.add(extract_top_directory(file_path))
		}
	}

	return [...directories].filter(Boolean)
}

const RUNTIME_DIRS = [
	'scripts',
	'scripts-ai',
	'prompts',
	'templates',
	'eslint',
	'prettier',
	'tsconfig',
	'cspell',
	'lefthook',
	'.github',
] as const

const AI_COPY_ROOT_FILES = [
	'CLAUDE.md',
	'AGENTS.md',
	'GEMINI.md',
	'CODE_OF_CONDUCT.md',
	'SECURITY.md',
	'.cursorrules',
	'.coderabbit.yaml',
	'.gitattributes',
	'.mcp.json',
	'.ncurc.json',
	'.prettierignore',
	'pnpm-workspace.yaml',
	'tsconfig.sonar.json',
	'wrangler.jsonc',
] as const

describe('package.json files field', () => {
	const manifest = load_manifest()
	const files = manifest.files ?? []

	it('is defined as an array', () => {
		expect(Array.isArray(manifest.files)).toBe(true)
	})

	it('includes all runtime directories', () => {
		expect(files).toEqual(expect.arrayContaining([...RUNTIME_DIRS]))
	})

	it('includes all AI-copy root files', () => {
		expect(files).toEqual(expect.arrayContaining([...AI_COPY_ROOT_FILES]))
	})

	it('covers every exports directory', () => {
		const export_directories = collect_export_directories(manifest.exports ?? {})

		for (const directory of export_directories) {
			expect(files).toContain(directory)
		}
	})

	it('covers the bin script directory', () => {
		const bin_directories = Object.values(manifest.bin ?? {}).map((file_path) =>
			extract_top_directory(file_path),
		)

		for (const directory of bin_directories) {
			expect(files).toContain(directory)
		}
	})

	it('excludes TypeScript test files via negation pattern', () => {
		expect(files).toContain('!**/*.test.ts')
	})

	it('excludes TypeScript spec files via negation pattern', () => {
		expect(files).toContain('!**/*.spec.ts')
	})
})

describe('package.json pnpm built-dependency lists', () => {
	const manifest = load_manifest()
	const only_built = manifest.pnpm?.onlyBuiltDependencies ?? []

	it('keeps native builds required by this project', () => {
		expect(only_built).toEqual(expect.arrayContaining(['esbuild', 'lefthook', 'unrs-resolver']))
	})
})

describe('package.json scripts', () => {
	const manifest = load_manifest()
	const scripts = manifest.scripts ?? {}

	it('exposes josh as the unified CLI entry point', () => {
		// eslint-disable-next-line dot-notation -- index signature requires bracket notation
		expect(scripts['josh']).toBe('tsx scripts/josh.ts')
	})

	it('does not expose audit:security as a standalone script', () => {
		expect(scripts['audit:security']).toBeUndefined()
	})

	it('does not use redundant pnpm run prefix in scripts', () => {
		const has_pnpm_run = Object.values(scripts).some((cmd) => /pnpm run [a-z]/u.test(cmd))

		expect(has_pnpm_run).toBe(false)
	})
})
