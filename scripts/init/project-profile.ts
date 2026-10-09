import { existsSync, readdirSync, readFileSync, type Dirent } from 'node:fs'
import path from 'node:path'
import { repo_origin } from '#scripts/discovery/repo-origin'
import { git_spawn_sync } from '#scripts/git/git-spawn-sync'
import { json_value } from '#scripts/lib/json-value'
import { KIT_PACKAGE_NAME } from '#scripts/version/kit-descriptor'

type ProjectProfile = 'basic' | 'full'

interface ProfileResult {
	profile: ProjectProfile
	reason: string
}

interface ProjectShape extends ProfileResult {
	has_web: boolean
	has_typescript: boolean
	has_git: boolean
	has_github: boolean
}

const IGNORED_DIRECTORIES = new Set(['.git', 'node_modules', 'dist', 'build', '.svelte-kit'])
const WEB_EXTENSIONS = new Set(['.html', '.css', '.js', '.jsx', '.mjs', '.cjs'])
const TYPESCRIPT_EXTENSIONS = new Set(['.ts', '.tsx'])
const PROFILE_ARG_LENGTH = 2
// The names before the profile rename. A project that recorded one, or a script that passes one
// to `--profile`, keeps working: each reads as the profile it was renamed to.
const PROFILE_NAMES: Readonly<Record<string, ProjectProfile>> = {
	basic: 'basic',
	full: 'full',
	static: 'basic',
	node: 'full',
}

function parse_profile(value: unknown): ProjectProfile | undefined {
	return typeof value === 'string' && Object.hasOwn(PROFILE_NAMES, value)
		? PROFILE_NAMES[value]
		: undefined
}

// The pre-rename name of each profile, which every kit with `--profile` accepts — the new one only
// from the rename on.
const LEGACY_NAMES: Readonly<Record<ProjectProfile, string>> = { basic: 'static', full: 'node' }

// A `josh init` handed to the project's kit may run an older kit than the one handing off: the
// project pinned it, or its `minimumReleaseAge` held the new release back. The pre-rename spelling
// is the one both kits read.
function with_legacy_profile_names(args: ReadonlyArray<string>): Array<string> {
	return args.map((argument, index) => {
		const profile = args[index - 1] === '--profile' ? parse_profile(argument) : undefined

		return profile === undefined ? argument : LEGACY_NAMES[profile]
	})
}

function is_profile_pair(args: ReadonlyArray<string>): boolean {
	return args.length === PROFILE_ARG_LENGTH && args[0] === '--profile'
}

function requested_profile(
	args: ReadonlyArray<string>,
	usage = 'josh init [--profile basic|full]',
): ProjectProfile | undefined {
	if (args.length === 0) return undefined
	if (!is_profile_pair(args)) throw new Error(`Usage: ${usage}`)

	const profile = parse_profile(args[1])
	if (profile !== undefined) return profile
	throw new Error('Profile must be basic or full')
}

function read_manifest(root: string): Record<string, unknown> | undefined {
	const filename = path.join(root, 'package.json')
	if (!existsSync(filename)) return undefined
	const parsed: unknown = JSON.parse(readFileSync(filename, 'utf8'))

	if (!json_value.is_record(parsed)) throw new Error('package.json must contain an object')

	return parsed
}

function recorded_profile(manifest: Record<string, unknown>): ProjectProfile | undefined {
	const { josh } = manifest

	return json_value.is_record(josh) ? parse_profile(josh['profile']) : undefined
}

function has_build_script(value: unknown): boolean {
	return json_value.is_record(value) && ('build' in value || 'dev' in value)
}

// kit itself is not evidence of a Node toolchain: `pnpm add -D @joshuafolkken/kit` before
// `josh init` is the documented order, and it must still leave an `index.html` site on the basic
// profile.
function has_project_dependencies(value: unknown): boolean {
	if (!json_value.is_record(value)) return false

	return Object.keys(value).some((name) => name !== KIT_PACKAGE_NAME)
}

function inferred_profile(manifest: Record<string, unknown>): ProfileResult {
	if (
		has_project_dependencies(manifest['dependencies']) ||
		has_project_dependencies(manifest['devDependencies'])
	) {
		return { profile: 'full', reason: 'package dependencies' }
	}

	if (has_build_script(manifest['scripts'])) {
		return { profile: 'full', reason: 'build or dev script' }
	}

	return { profile: 'basic', reason: 'metadata-only package.json' }
}

function resolve_profile(root: string, requested?: ProjectProfile): ProfileResult {
	if (requested !== undefined) return { profile: requested, reason: 'explicit --profile' }
	const manifest = read_manifest(root)
	if (manifest === undefined) return { profile: 'basic', reason: 'no package.json' }
	const profile = recorded_profile(manifest)
	if (profile !== undefined) return { profile, reason: 'package.json josh.profile' }

	return inferred_profile(manifest)
}

function should_visit(entry: Dirent): boolean {
	return entry.isDirectory() && !IGNORED_DIRECTORIES.has(entry.name)
}

function scan_directory(directory: string, pending: Array<string>): Array<string> {
	const entries = readdirSync(directory, { withFileTypes: true })

	pending.push(
		...entries
			.filter((entry) => should_visit(entry))
			.map((entry) => path.join(directory, entry.name)),
	)

	return entries.filter((entry) => entry.isFile()).map((entry) => path.extname(entry.name))
}

function file_extensions(root: string): Array<string> {
	const pending = [root]
	const extensions: Array<string> = []

	for (const directory of pending) {
		extensions.push(...scan_directory(directory, pending))
	}

	return extensions
}

function scan_files(root: string): { has_web: boolean; has_typescript: boolean } {
	const extensions = file_extensions(root)
	const has_web = extensions.some((extension) => WEB_EXTENSIONS.has(extension))
	const has_typescript = extensions.some((extension) => TYPESCRIPT_EXTENSIONS.has(extension))

	return { has_web, has_typescript }
}

function has_github_remote(root: string): boolean {
	const url = git_spawn_sync.origin_url(root)

	return url !== undefined && repo_origin.parse_origin_url(url) !== undefined
}

function inspect_project(root: string, requested?: ProjectProfile): ProjectShape {
	const profile = resolve_profile(root, requested)
	const files = scan_files(root)
	const has_git = existsSync(path.join(root, '.git'))

	return { ...profile, ...files, has_git, has_github: has_git && has_github_remote(root) }
}

const project_profile = {
	parse_profile,
	resolve_profile,
	inspect_project,
	requested_profile,
	with_legacy_profile_names,
}
export { project_profile }
export type { ProjectProfile, ProjectShape }
