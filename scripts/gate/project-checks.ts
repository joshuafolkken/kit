import { existsSync, globSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { find_local_bin_upwards } from '#scripts/build/local-bin'
import { doctor_consumer } from '#scripts/doctor/doctor-consumer'
import { project_profile } from '#scripts/init/project-profile'
import { ancestor_directories } from '#scripts/lib/ancestor-directories'
import { json_value } from '#scripts/lib/json-value'
import { SKIP_MARKER } from '#scripts/test/skip-marker'
import { z } from 'zod'

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
const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies']
const object_schema = z.record(z.string(), z.unknown())

function project_root(directory: string): string {
	return (
		ancestor_directories.nearest(directory, (candidate) =>
			existsSync(path.join(candidate, PACKAGE_JSON)),
		) ?? directory
	)
}

// The kit repository itself rather than a consumer of it — the gate's and the detached ship's one
// answer to whether kit-only checks run.
function is_kit_repository(directory: string): boolean {
	return !doctor_consumer.is_kit_consumer(project_root(directory))
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
	return json_value.is_record(manifest) ? manifest['josh'] : undefined
}

function is_basic_manifest(manifest: unknown): boolean {
	const josh = josh_settings(manifest)
	if (!json_value.is_record(josh)) return false

	return project_profile.parse_profile(josh['profile']) === 'basic'
}

// The try covers the read alone — a missing or unreadable manifest — since the parse already answers
// `undefined` for text that is not JSON.
function read_manifest(directory: string): unknown {
	try {
		const manifest_path = path.join(project_root(directory), PACKAGE_JSON)

		return json_value.parse_or_undefined(readFileSync(manifest_path, 'utf8'))
	} catch {
		return undefined
	}
}

function is_basic(directory: string): boolean {
	return is_basic_manifest(read_manifest(directory))
}

function is_declared(directory: string, package_name: string): boolean {
	const manifest = object_schema.safeParse(read_manifest(directory))
	if (!manifest.success) return false

	return DEPENDENCY_FIELDS.some((field) => {
		const dependencies = object_schema.safeParse(manifest.data[field])

		return dependencies.success && Object.hasOwn(dependencies.data, package_name)
	})
}

// A tool the manifest lists but `node_modules` lacks is a project that has not run `pnpm install`
// yet — typically right after `josh init` added it. Skipping it would pass a
// check the configuration asks for without running it, so only an undeclared tool is skipped; a
// declared one is run and fails until it is installed.
function missing_tool_reason(
	directory: string,
	package_name: string,
	bin_name: string,
): string | undefined {
	if (has_bin(directory, bin_name) || is_declared(directory, package_name)) return undefined

	return `${package_name} is not installed`
}

function skip_notice(check: string, reason: string): string {
	return `josh ${check}: ${reason} ${SKIP_MARKER} ${check}.`
}

// Shared by `josh check` and the gate's type-check step, so neither reaches `tsc` on a basic
// project that has nothing to type-check.
function type_check_skip_reason(directory: string): string | undefined {
	if (!is_basic(directory)) return undefined
	if (!has_files(directory, TYPE_FILES)) return 'no TypeScript files were found'
	if (!has_config(directory, TYPE_CONFIGS)) return 'no TypeScript configuration was found'

	return missing_tool_reason(directory, 'typescript', 'tsc')
}

// Shared by `josh lint`, `josh lint:related` and `josh format`, so a basic project without Web
// files — a Python or Rust project, which `josh init` gives no Prettier — is skipped for the same
// reason by all three.
function prettier_skip_reason(directory: string): string | undefined {
	if (!is_basic(directory)) return undefined
	if (!has_files(directory, WEB_FILES)) return 'no HTML, CSS or JavaScript files were found'

	return missing_tool_reason(directory, 'prettier', 'prettier')
}

// Shared by `josh lint`, `josh lint:related` and `josh format`, so a basic project without ESLint
// is skipped for the same reason by all three.
function eslint_skip_reason(directory: string): string | undefined {
	if (!is_basic(directory)) return undefined
	if (!has_files(directory, SCRIPT_FILES)) return 'no JavaScript or TypeScript files were found'
	if (!has_config(directory, ESLINT_CONFIGS)) return 'no ESLint configuration was found'

	return missing_tool_reason(directory, 'eslint', 'eslint')
}

const project_checks = {
	CSPELL_CONFIGS,
	ESLINT_CONFIGS,
	TYPE_FILES,
	WEB_FILES,
	eslint_skip_reason,
	has_bin,
	has_config,
	has_files,
	is_basic,
	is_kit_repository,
	prettier_skip_reason,
	project_root,
	skip_notice,
	type_check_skip_reason,
}

export { project_checks }
