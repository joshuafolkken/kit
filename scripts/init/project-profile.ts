import { existsSync, readdirSync, readFileSync, type Dirent } from 'node:fs'
import path from 'node:path'
import { repo_origin } from '#scripts/discovery/repo-origin'
import { KIT_PACKAGE_NAME } from '#scripts/version/kit-descriptor'
import { execaSync } from 'execa'

type ProjectProfile = 'static' | 'node'

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

function parse_profile(value: unknown): ProjectProfile | undefined {
	if (value === 'static' || value === 'node') return value

	return undefined
}

function is_profile_pair(args: ReadonlyArray<string>): boolean {
	return args.length === PROFILE_ARG_LENGTH && args[0] === '--profile'
}

function requested_profile(
	args: ReadonlyArray<string>,
	usage = 'josh init [--profile static|node]',
): ProjectProfile | undefined {
	if (args.length === 0) return undefined
	if (!is_profile_pair(args)) throw new Error(`Usage: ${usage}`)

	const profile = parse_profile(args[1])
	if (profile !== undefined) return profile
	throw new Error('Profile must be static or node')
}

function read_manifest(root: string): Record<string, unknown> | undefined {
	const filename = path.join(root, 'package.json')
	if (!existsSync(filename)) return undefined
	const parsed: unknown = JSON.parse(readFileSync(filename, 'utf8'))

	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
		throw new Error('package.json must contain an object')
	}

	return parsed as Record<string, unknown>
}

function is_record(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function recorded_profile(manifest: Record<string, unknown>): ProjectProfile | undefined {
	const { josh } = manifest

	return is_record(josh) ? parse_profile(josh['profile']) : undefined
}

function has_build_script(value: unknown): boolean {
	return is_record(value) && ('build' in value || 'dev' in value)
}

// kit itself is not evidence of a Node toolchain: `pnpm add -D @joshuafolkken/kit` before
// `josh init` is the documented order, and it must still leave an `index.html` site static
// (joshuafolkken/kit#2693).
function has_project_dependencies(value: unknown): boolean {
	if (!is_record(value)) return false

	return Object.keys(value).some((name) => name !== KIT_PACKAGE_NAME)
}

function inferred_profile(manifest: Record<string, unknown>): ProfileResult {
	if (
		has_project_dependencies(manifest['dependencies']) ||
		has_project_dependencies(manifest['devDependencies'])
	) {
		return { profile: 'node', reason: 'package dependencies' }
	}

	if (has_build_script(manifest['scripts'])) {
		return { profile: 'node', reason: 'build or dev script' }
	}

	return { profile: 'static', reason: 'metadata-only package.json' }
}

function resolve_profile(root: string, requested?: ProjectProfile): ProfileResult {
	if (requested !== undefined) return { profile: requested, reason: 'explicit --profile' }
	const manifest = read_manifest(root)
	if (manifest === undefined) return { profile: 'static', reason: 'no package.json' }
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
	const result = execaSync('git', ['config', '--get', 'remote.origin.url'], {
		cwd: root,
		reject: false,
	})

	return result.exitCode === 0 && repo_origin.parse_origin_url(result.stdout) !== undefined
}

function inspect_project(root: string, requested?: ProjectProfile): ProjectShape {
	const profile = resolve_profile(root, requested)
	const files = scan_files(root)
	const has_git = existsSync(path.join(root, '.git'))

	return { ...profile, ...files, has_git, has_github: has_git && has_github_remote(root) }
}

const project_profile = { resolve_profile, inspect_project, requested_profile }
export { project_profile }
export type { ProjectProfile, ProjectShape }
