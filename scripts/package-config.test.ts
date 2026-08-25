import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { package_path } from './init/init-paths'
import { yaml_config_fixture } from './yaml-config-fixture'

interface PackageJson {
	files?: Array<string>
	bin?: Record<string, string>
	exports?: Record<string, unknown>
	pnpm?: {
		overrides?: Record<string, string>
		onlyBuiltDependencies?: Array<string>
	}
	scripts?: Record<string, string>
}

interface WorkspaceYaml {
	allowBuilds?: Record<string, boolean>
	trustLockfile?: boolean
}

// Resolved from the package root, like load_workspace below, so both readers keep reading the
// files they name no matter which directory the runner was started in.
function load_manifest(): PackageJson {
	const content = readFileSync(package_path('package.json'), 'utf8')

	return JSON.parse(content) as PackageJson
}

const WORKSPACE_CONFIG = 'pnpm-workspace.yaml'

function load_workspace(): WorkspaceYaml {
	return yaml_config_fixture.load_yaml_config(WORKSPACE_CONFIG) as WorkspaceYaml
}

function extract_top_directory(file_path: string): string {
	return file_path.replace(/^\.\//u, '').split('/', 1)[0] ?? ''
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
	// `josh eval` reads its scenarios from the installed package, so a release without them turns a
	// registered command into an ENOENT for every consumer.
	'evals',
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
	WORKSPACE_CONFIG,
	'tsconfig.sonar.json',
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

describe('pnpm-workspace.yaml built-dependency lists', () => {
	const workspace = load_workspace()
	const allow_builds = workspace.allowBuilds ?? {}

	it('allows native builds required by this project', () => {
		expect(allow_builds).toMatchObject({ esbuild: true, lefthook: true, 'unrs-resolver': true })
	})

	it('blocks kit postinstall to prevent lefthook-not-found errors in CI', () => {
		expect(allow_builds['@joshuafolkken/kit']).toBe(false)
	})

	it('package.json does not duplicate onlyBuiltDependencies', () => {
		const manifest = load_manifest()

		expect(manifest.pnpm?.onlyBuiltDependencies).toBeUndefined()
	})

	it('trusts the committed lockfile so pnpm 11.5 supply-chain re-check does not break CI', () => {
		// Synced to consumers; skips the install-time re-verification that fails on clean CI
		// boxes lacking auth for private @joshuafolkken/* GitHub Packages (false URL mismatch).
		expect(workspace.trustLockfile).toBe(true)
	})
})

const TEST_FILENAME_EXPORT_KEY = './eslint/test-filename'
const TEST_FILENAME_EXPORT_TARGET = './eslint/rules/test-filename.js'

describe('package.json exports', () => {
	const manifest = load_manifest()
	const exports_map = manifest.exports ?? {}

	it('exposes the generic test-filename rule building blocks for consumers (issue #626)', () => {
		expect(exports_map[TEST_FILENAME_EXPORT_KEY]).toBe(TEST_FILENAME_EXPORT_TARGET)
	})

	it('points the test-filename export at a file that exists on disk', () => {
		expect(existsSync(package_path(TEST_FILENAME_EXPORT_TARGET))).toBe(true)
	})
})

describe('package.json scripts', () => {
	const manifest = load_manifest()
	const scripts = manifest.scripts ?? {}

	it('exposes josh as the unified CLI entry point', () => {
		// eslint-disable-next-line dot-notation -- index signature requires bracket notation
		expect(scripts['josh']).toBe('tsx scripts/josh/josh.ts')
	})

	it('does not expose audit:security as a standalone script', () => {
		expect(scripts['audit:security']).toBeUndefined()
	})

	it('does not use redundant pnpm run prefix in scripts', () => {
		const has_pnpm_run = Object.values(scripts).some((cmd) => /pnpm run [a-z]/u.test(cmd))

		expect(has_pnpm_run).toBe(false)
	})

	it('does not install a project-pinned bin shim on postinstall', () => {
		// eslint-disable-next-line dot-notation -- index signature requires bracket notation
		expect(scripts['postinstall'] ?? '').not.toContain('install-bin')
	})

	it('installs lefthook git hooks via prepare for contributors', () => {
		// eslint-disable-next-line dot-notation -- index signature requires bracket notation
		expect(scripts['prepare']).toContain('lefthook install')
	})

	it('does not run lefthook on postinstall so global and consumer installs do not abort', () => {
		// lefthook requires a git repo; running it on postinstall fails (exit 128)
		// during `pnpm add -g` and consumer installs, which run outside any git repo.
		// eslint-disable-next-line dot-notation -- index signature requires bracket notation
		expect(scripts['postinstall'] ?? '').not.toContain('lefthook')
	})
})

const RANGE_GUARD_SCRIPT = 'publishable-range-check'
const BIN_BUILD_SCRIPT = 'build-bin'

describe('package.json prepack', () => {
	// eslint-disable-next-line dot-notation -- index signature requires bracket notation
	const prepack = load_manifest().scripts?.['prepack'] ?? ''

	it('builds the compiled bin before packing', () => {
		expect(prepack).toContain(BIN_BUILD_SCRIPT)
	})

	it('gates packing on every published dependency range still resolving', () => {
		expect(prepack).toContain(RANGE_GUARD_SCRIPT)
	})

	// The guard has to run before the build steps: a range no consumer can resolve makes the
	// published package uninstallable (#742), so there is nothing worth building past that point.
	it('runs the range guard before the build steps', () => {
		expect(prepack.indexOf(RANGE_GUARD_SCRIPT)).toBeLessThan(prepack.indexOf(BIN_BUILD_SCRIPT))
	})
})

describe('package.json bin', () => {
	const manifest = load_manifest()

	it('points josh at the compiled, project-independent bin', () => {
		// eslint-disable-next-line dot-notation -- index signature requires bracket notation
		expect(manifest.bin?.['josh']).toBe('dist/josh.js')
	})
})
