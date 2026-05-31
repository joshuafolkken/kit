import { loadAll } from 'js-yaml'
import { z } from 'zod'

const GH_PACKAGES_HOST = 'npm.pkg.github.com'
const RESOLUTION_BLOCK = '\n    resolution:\n'
const INTEGRITY_PREFIX = '      integrity: '
const TARBALL_PREFIX = '      tarball: '
const FLOW_RESOLUTION_LINE_START = '\n    resolution: {'
const FLOW_TARBALL_KEY = ', tarball: '
const NPMRC_AUTH_TOKEN_PREFIX = `//${GH_PACKAGES_HOST}/:_authToken=`
const REGISTRY_KEY = ':registry='

interface PackageResolution {
	integrity?: string | undefined
	tarball?: string | undefined
}

interface LockfilePackage {
	resolution?: PackageResolution | undefined
}

const lockfile_resolution_schema = z.looseObject({
	integrity: z.string().optional(),
	tarball: z.string().optional(),
})
const lockfile_package_schema = z.looseObject({
	resolution: lockfile_resolution_schema.optional(),
})
const lockfile_document_schema = z.looseObject({
	packages: z.record(z.string(), lockfile_package_schema).optional(),
})

// pnpm 11 writes pnpm-lock.yaml as a multi-document YAML stream (the @pnpm/exe
// self-management document precedes the project document). load() only accepts a
// single document and throws, so parse every document and merge their packages.
function parse_lockfile_packages(raw: string): Record<string, LockfilePackage> {
	const merged: Record<string, LockfilePackage> = {}

	for (const document of loadAll(raw)) {
		const { packages } = lockfile_document_schema.parse(document)
		if (packages !== undefined) Object.assign(merged, packages)
	}

	return merged
}

function is_gh_registry_line(line: string): string | undefined {
	const trimmed = line.trim()
	if (!trimmed.startsWith('@')) return undefined
	const eq_index = trimmed.indexOf(REGISTRY_KEY)
	if (eq_index === -1) return undefined
	const registry = trimmed
		.slice(eq_index + REGISTRY_KEY.length)
		.trim()
		.replace(/\/$/u, '')
	if (registry !== `https://${GH_PACKAGES_HOST}`) return undefined

	return trimmed.slice(0, eq_index)
}

function parse_gh_scopes(npmrc: string): Set<string> {
	const scopes = new Set<string>()

	for (const line of npmrc.split('\n')) {
		const scope = is_gh_registry_line(line)
		if (scope !== undefined) scopes.add(scope)
	}

	return scopes
}

function extract_auth_token_from_line(line: string): string | undefined {
	const trimmed = line.trim()
	if (!trimmed.startsWith(NPMRC_AUTH_TOKEN_PREFIX)) return undefined
	const value = trimmed.slice(NPMRC_AUTH_TOKEN_PREFIX.length)
	if (value.startsWith('${') || value.length === 0) return undefined

	return value
}

function parse_npmrc_auth_token(npmrc: string): string | undefined {
	for (const line of npmrc.split('\n')) {
		const token = extract_auth_token_from_line(line)
		if (token !== undefined) return token
	}

	return undefined
}

function scope_from_key(key: string): string {
	return key.startsWith('@') ? (key.split('/')[0] ?? '') : ''
}

function has_tarball(entry: LockfilePackage): boolean {
	return entry.resolution?.tarball !== undefined
}

function package_path_from_key(key: string): string {
	const start = key.startsWith('@') ? 1 : 0
	const at_index = key.indexOf('@', start)

	return at_index === -1 ? key : key.slice(0, at_index)
}

function package_version_from_key(key: string): string {
	const start = key.startsWith('@') ? 1 : 0
	const at_index = key.indexOf('@', start)
	if (at_index === -1) return ''

	return key.slice(at_index + 1).split('(')[0] ?? ''
}

function needs_tarball_fix(key: string, entry: LockfilePackage, scopes: Set<string>): boolean {
	if (has_tarball(entry)) return false
	const scope = scope_from_key(key)

	return scope.length > 0 && scopes.has(scope)
}

function find_entry_start(content: string, package_key: string): number {
	const single = content.indexOf(`\n  '${package_key}':\n`)
	if (single !== -1) return single

	return content.indexOf(`\n  "${package_key}":\n`)
}

function find_entry_end(content: string, entry_start: number): number {
	const next_match = /\n {2}['"]/u.exec(content.slice(entry_start + 1))

	return next_match === null ? content.length : entry_start + 1 + next_match.index
}

function find_integrity_eol_in_entry(entry_content: string): number {
	const resolution_pos = entry_content.indexOf(RESOLUTION_BLOCK)
	if (resolution_pos === -1) return -1
	const integrity_pos = entry_content.indexOf(INTEGRITY_PREFIX, resolution_pos)
	if (integrity_pos === -1) return -1

	return entry_content.indexOf('\n', integrity_pos)
}

function find_flow_resolution_brace(entry_content: string): number {
	const pos = entry_content.indexOf(FLOW_RESOLUTION_LINE_START)
	if (pos === -1) return -1
	const line_end = entry_content.indexOf('\n', pos + 1)
	const search_end = line_end === -1 ? entry_content.length : line_end
	const brace = entry_content.lastIndexOf('}', search_end)
	if (brace <= pos) return -1

	return brace
}

function insert_expanded_tarball(
	content: string,
	entry_start: number,
	entry_end: number,
	tarball: string,
): string | undefined {
	const entry_content = content.slice(entry_start, entry_end)
	const integrity_eol = find_integrity_eol_in_entry(entry_content)
	if (integrity_eol === -1) return undefined
	if (entry_content.slice(integrity_eol + 1).startsWith(TARBALL_PREFIX)) return content
	const patched = `${entry_content.slice(0, integrity_eol + 1)}${TARBALL_PREFIX}${tarball}\n${entry_content.slice(integrity_eol + 1)}`

	return content.slice(0, entry_start) + patched + content.slice(entry_end)
}

function insert_flow_tarball(
	content: string,
	entry_start: number,
	entry_end: number,
	tarball: string,
): string | undefined {
	const entry_content = content.slice(entry_start, entry_end)
	const brace_pos = find_flow_resolution_brace(entry_content)
	if (brace_pos === -1) return undefined
	const open_brace = entry_content.lastIndexOf('{', brace_pos)
	if (open_brace === -1) return undefined
	const flow_body = entry_content.slice(open_brace + 1, brace_pos)
	if (/\btarball\s*:/u.test(flow_body)) return content
	const patched = `${entry_content.slice(0, brace_pos)}${FLOW_TARBALL_KEY}${tarball}${entry_content.slice(brace_pos)}`

	return content.slice(0, entry_start) + patched + content.slice(entry_end)
}

function insert_tarball_for_key(content: string, package_key: string, tarball: string): string {
	const entry_start = find_entry_start(content, package_key)
	if (entry_start === -1) return content
	const entry_end = find_entry_end(content, entry_start)

	return (
		insert_expanded_tarball(content, entry_start, entry_end, tarball) ??
		insert_flow_tarball(content, entry_start, entry_end, tarball) ??
		content
	)
}

function patch_lockfile(content: string, patches: Map<string, string>): string {
	let result = content

	for (const [key, tarball] of patches) {
		result = insert_tarball_for_key(result, key, tarball)
	}

	return result
}

function resolve_token(
	environment_token: string | undefined,
	npmrc_token: string | undefined,
	get_fallback_token: () => string | undefined,
): string | undefined {
	if (environment_token !== undefined && environment_token.length > 0) return environment_token
	if (npmrc_token !== undefined) return npmrc_token

	return get_fallback_token()
}

const fix_gh_packages_logic = {
	parse_gh_scopes,
	parse_npmrc_auth_token,
	parse_lockfile_packages,
	package_path_from_key,
	package_version_from_key,
	needs_tarball_fix,
	insert_tarball_for_key,
	patch_lockfile,
	resolve_token,
}

export { fix_gh_packages_logic }
export type { LockfilePackage, PackageResolution }
