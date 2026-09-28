import { existsSync, globSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { find_local_bin_upwards } from '#scripts/build/local-bin'
import { SKIP_MARKER } from '#scripts/test/skip-marker'

const PACKAGE_JSON = 'package.json'
const IGNORED_DIRS = new Set([
	'node_modules',
	'.git',
	'.venv',
	'venv',
	'target',
	'dist',
	'build',
	'.svelte-kit',
])
const WEB_FILES = '**/*.{html,css,js,jsx,mjs,cjs}'
const SCRIPT_FILES = '**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}'
const TYPE_FILES = '**/*.{ts,tsx,mts,cts}'
const ESLINT_CONFIGS = [
	'eslint.config.js',
	'eslint.config.mjs',
	'eslint.config.cjs',
	'eslint.config.ts',
	'eslint.config.mts',
	'eslint.config.cts',
]
const CSPELL_CONFIGS = [
	'cspell.config.yaml',
	'cspell.config.yml',
	'cspell.config.json',
	'cspell.config.js',
	'cspell.config.cjs',
	'cspell.config.mjs',
	'cspell.json',
	'cspell.yaml',
]
const TYPE_CONFIGS = ['tsconfig.json', 'jsconfig.json']

function project_root(directory: string): string {
	let current = directory

	while (!existsSync(path.join(current, PACKAGE_JSON))) {
		const parent = path.dirname(current)
		if (parent === current) return directory
		current = parent
	}

	return current
}

function is_ignored(entry: string): boolean {
	return entry.split(/[/\\]/u).some((part) => IGNORED_DIRS.has(part))
}

function has_files(directory: string, pattern: string): boolean {
	return globSync(pattern, { cwd: project_root(directory), exclude: is_ignored }).length > 0
}

function has_config(directory: string, names: ReadonlyArray<string>): boolean {
	return names.some((name) => existsSync(path.join(project_root(directory), name)))
}

function has_bin(directory: string, bin_name: string): boolean {
	return find_local_bin_upwards(directory, bin_name) !== undefined
}

function josh_settings(manifest: unknown): unknown {
	if (typeof manifest !== 'object' || manifest === null || !('josh' in manifest)) return undefined

	return manifest.josh
}

function is_static_manifest(manifest: unknown): boolean {
	const josh = josh_settings(manifest)
	if (typeof josh !== 'object' || josh === null || !('profile' in josh)) return false

	return josh.profile === 'static'
}

function is_static(directory: string): boolean {
	try {
		const manifest_path = path.join(project_root(directory), PACKAGE_JSON)
		const manifest: unknown = JSON.parse(readFileSync(manifest_path, 'utf8'))

		return is_static_manifest(manifest)
	} catch {
		return false
	}
}

function skip_notice(check: string, reason: string): string {
	return `josh ${check}: ${reason} ${SKIP_MARKER} ${check}.`
}

function type_check_skip_reason(directory: string): string | undefined {
	if (!is_static(directory)) return undefined
	if (!has_files(directory, TYPE_FILES)) return 'no TypeScript files were found'
	if (!has_config(directory, TYPE_CONFIGS)) return 'no TypeScript configuration was found'
	if (!has_bin(directory, 'tsc')) return 'typescript is not installed'

	return undefined
}

const project_checks = {
	CSPELL_CONFIGS,
	ESLINT_CONFIGS,
	SCRIPT_FILES,
	TYPE_CONFIGS,
	TYPE_FILES,
	WEB_FILES,
	has_bin,
	has_config,
	has_files,
	is_static,
	project_root,
	skip_notice,
	type_check_skip_reason,
}

export { project_checks }
