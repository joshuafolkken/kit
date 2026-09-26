import { fix_gh_packages_logic } from '#scripts/gh/fix-gh-packages-logic'

const SCOPE = '@joshuafolkken'
const REGISTRY_KEY = `${SCOPE}:registry`
const PUBLIC_REGISTRY = 'https://registry.npmjs.org/'
const GITHUB_REGISTRY = 'https://npm.pkg.github.com/'
const MAPPING = `${REGISTRY_KEY}=${PUBLIC_REGISTRY}`
const REGISTRY_VALUE_INDEX = 1
const SPLIT_LIMIT = 2

interface MigrationPlan {
	content: string
	packages: ReadonlyArray<string>
	blocked: ReadonlyArray<string>
	change: string
}

type IntegrityPair = readonly [string, string]

function normalized_registry(value: string): string {
	let normalized = value.trim()
	while (normalized.endsWith('/')) normalized = normalized.slice(0, -1)

	return `${normalized}/`
}

function mapping_lines(content: string): ReadonlyArray<string> {
	return content.split(/\r?\n/u).filter((line) => line.trimStart().startsWith(`${REGISTRY_KEY}=`))
}

function registry_of(content: string): string | undefined {
	const lines = mapping_lines(content)
	if (lines.length !== 1) return undefined

	return normalized_registry(lines[0]?.split('=', SPLIT_LIMIT)[REGISTRY_VALUE_INDEX] ?? '')
}

function scoped_packages(lockfile: string): ReadonlyArray<string> {
	const packages = fix_gh_packages_logic.parse_lockfile_packages(lockfile)

	return Object.keys(packages)
		.filter((key) => key.startsWith(`${SCOPE}/`))
		.map((key) => fix_gh_packages_logic.package_path_from_key(key))
		.filter((name, index, names) => names.indexOf(name) === index)
}

function scoped_versions(lockfile: string): ReadonlyArray<readonly [string, string]> {
	const packages = fix_gh_packages_logic.parse_lockfile_packages(lockfile)

	return Object.keys(packages)
		.filter((key) => key.startsWith(`${SCOPE}/`))
		.map(
			(key) =>
				[
					fix_gh_packages_logic.package_path_from_key(key),
					fix_gh_packages_logic.package_version_from_key(key),
				] as const,
		)
}

function github_tarballs(lockfile: string): ReadonlyArray<string> {
	const packages = fix_gh_packages_logic.parse_lockfile_packages(lockfile)

	return Object.entries(packages)
		.filter(
			([key, entry]) =>
				key.startsWith(`${SCOPE}/`) &&
				entry.resolution?.tarball?.includes('npm.pkg.github.com') === true,
		)
		.map(([key]) => key)
}

function remove_flow_tarball(line: string): string {
	const marker = ', tarball: https://npm.pkg.github.com/'
	const start = line.indexOf(marker)
	if (start === -1) return line
	const end = line.indexOf('}', start)
	if (end === -1) return line

	return `${line.slice(0, start)}${line.slice(end)}`
}

function is_package_entry(line: string): boolean {
	return /^ {2}[^ ]/u.test(line)
}

function is_github_tarball_line(line: string): boolean {
	return line.trimStart().startsWith('tarball: https://npm.pkg.github.com/')
}

function clean_kit_line(
	line: string,
	version: string,
	integrities: ReadonlyMap<string, IntegrityPair>,
): string | undefined {
	if (!version) return line
	if (is_github_tarball_line(line)) return undefined
	const cleaned = remove_flow_tarball(line)
	const pair = integrities.get(version)
	if (pair === undefined) return cleaned

	return cleaned.split(`integrity: ${pair[0]}`).join(`integrity: ${pair[1]}`)
}

function next_kit_version(line: string, version: string): string {
	if (!is_package_entry(line)) return version
	const prefix = "  '@joshuafolkken/kit@"

	return line.startsWith(prefix) ? (line.slice(prefix.length).split("'", 1)[0] ?? '') : ''
}

function integrity_pair(
	old_integrity: string | undefined,
	npm_integrity: string | undefined,
): IntegrityPair | undefined {
	if (old_integrity === undefined || npm_integrity === undefined) return undefined

	return [old_integrity, npm_integrity]
}

function lock_integrities(
	lockfile: string,
	npm_integrities: ReadonlyMap<string, string>,
): Map<string, IntegrityPair> {
	const packages = fix_gh_packages_logic.parse_lockfile_packages(lockfile)
	const pairs = new Map<string, IntegrityPair>()
	const kit_entries = Object.entries(packages).filter(([key]) => key.startsWith(`${SCOPE}/kit@`))

	for (const [key, entry] of kit_entries) {
		const version = fix_gh_packages_logic.package_version_from_key(key)
		const pair = integrity_pair(entry.resolution?.integrity, npm_integrities.get(version))
		if (pair !== undefined) pairs.set(version, pair)
	}

	return pairs
}

function push_if_defined(lines: Array<string>, cleaned: string | undefined): void {
	if (cleaned !== undefined) lines.push(cleaned)
}

function rewrite_kit_lockfile(
	lockfile: string,
	npm_integrities: ReadonlyMap<string, string>,
): string {
	let kit_version = ''
	const lines: Array<string> = []
	const integrities = lock_integrities(lockfile, npm_integrities)

	for (const line of lockfile.split('\n')) {
		kit_version = next_kit_version(line, kit_version)
		const cleaned = clean_kit_line(line, kit_version, integrities)

		push_if_defined(lines, cleaned)
	}

	return lines.join('\n')
}

function append_mapping(content: string, eol: string): string {
	const separator = content && !content.endsWith('\n') ? eol : ''

	return `${content}${separator}${MAPPING}${eol}`
}

function replace_mapping(content: string): string {
	const lines = mapping_lines(content)
	const eol = content.includes('\r\n') ? '\r\n' : '\n'

	if (lines.length === 0) return append_mapping(content, eol)

	return content
		.split(/\r?\n/u)
		.map((line) => (line === lines[0] ? MAPPING : line))
		.join(eol)
}

function unsupported_registry(project_npmrc: string): string | undefined {
	const registry = registry_of(project_npmrc)

	if (registry === undefined || [GITHUB_REGISTRY, PUBLIC_REGISTRY].includes(registry)) {
		return undefined
	}

	return `unsupported project registry: ${registry}`
}

function has_duplicate_mapping(project_npmrc: string, user_npmrc: string): boolean {
	return mapping_lines(project_npmrc).length > 1 || mapping_lines(user_npmrc).length > 1
}

function previous_registry(project_npmrc: string, user_npmrc: string): string {
	return registry_of(project_npmrc) ?? registry_of(user_npmrc) ?? 'default npm'
}

function plan(project_npmrc: string, user_npmrc: string, lockfile: string): MigrationPlan {
	const packages = scoped_packages(lockfile)
	const blocked = packages.filter((name) => name !== `${SCOPE}/kit`)
	if (has_duplicate_mapping(project_npmrc, user_npmrc)) blocked.push('duplicate registry mappings')
	const unsupported = unsupported_registry(project_npmrc)
	if (unsupported !== undefined) blocked.push(unsupported)
	const before = previous_registry(project_npmrc, user_npmrc)
	const change = `${before} → ${PUBLIC_REGISTRY}`

	return { content: replace_mapping(project_npmrc), packages, blocked, change }
}

const migrate_logic = {
	plan,
	github_tarballs,
	rewrite_kit_lockfile,
	registry_of,
	scoped_packages,
	scoped_versions,
}

export { migrate_logic }
export type { MigrationPlan }
