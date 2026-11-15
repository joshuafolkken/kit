import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { fix_gh_packages_logic } from '#scripts/gh/fix-gh-packages-logic'
import { yaml_document } from '#scripts/lib/yaml-document'
import { dump } from 'js-yaml'

const SCOPE = '@joshuafolkken/'
const KIT = `${SCOPE}kit`
const REGISTRY = 'https://registry.npmjs.org/'
const PNPM_VERSION = '12.17.0'

interface LockedArtifact {
	name: string
	version: string
	integrity: string | undefined
}

function scoped_artifacts(content: string): Array<LockedArtifact> {
	return Object.entries(fix_gh_packages_logic.parse_lockfile_packages(content))
		.filter(([key]) => key.startsWith(SCOPE))
		.map(([key, entry]) => ({
			name: fix_gh_packages_logic.package_path_from_key(key),
			version: fix_gh_packages_logic.package_version_from_key(key),
			integrity: entry.resolution?.integrity,
		}))
}

function importer_manifests(content: string): Array<string> {
	return yaml_document
		.parse_yaml_documents(content)
		.flatMap((document) =>
			yaml_document.is_mapping_document(document['importers'])
				? Object.keys(document['importers'])
				: [],
		)
		.map((importer) => path.join(importer, 'package.json'))
}

function non_npm_resolution(content: string): string | undefined {
	const entries = Object.entries(fix_gh_packages_logic.parse_lockfile_packages(content)).filter(
		([key]) => key.startsWith(SCOPE),
	)

	for (const [key, entry] of entries) {
		const tarball = entry.resolution?.tarball

		if (tarball !== undefined && !tarball.startsWith(REGISTRY)) return key
	}

	return undefined
}

function has_npm_sources(content: string): boolean {
	return non_npm_resolution(content) === undefined
}

function assert_npm_sources(content: string): void {
	const key = non_npm_resolution(content)
	if (key !== undefined) throw new Error(`Non-npm resolution remains: ${key}`)
}

function npmrc(content: string): string {
	const newline = content.includes('\r\n') ? '\r\n' : '\n'
	const lines = content
		.split(/\r?\n/u)
		.filter((line) => !/^\s*@joshuafolkken:registry\s*=/u.test(line))

	while (lines.at(-1) === '') lines.pop()
	lines.push(`@joshuafolkken:registry=${REGISTRY}`, '')

	return lines.join(newline)
}

function strip_tarball(resolution: unknown): void {
	if (yaml_document.is_mapping_document(resolution)) delete resolution['tarball']
}

// Registry metadata that differs between registries without changing what resolves: npm marks
// packages deprecated, and lists this scope's optional peers where GitHub Packages omits them.
function strip_registry_metadata(key: string, entry: Record<string, unknown>): void {
	delete entry['deprecated']
	if (!key.startsWith(SCOPE)) return
	delete entry['peerDependenciesMeta']
	strip_tarball(entry['resolution'])
}

function mapping_entries(section: unknown): Array<[string, Record<string, unknown>]> {
	if (!yaml_document.is_mapping_document(section)) return []

	return Object.entries(section).filter((pair): pair is [string, Record<string, unknown>] =>
		yaml_document.is_mapping_document(pair[1]),
	)
}

function strip_resolutions(document: Record<string, unknown>): void {
	const entries = mapping_entries(document['packages'])

	for (const [key, entry] of entries) strip_registry_metadata(key, entry)
}

function sort_peers(entry: Record<string, unknown>): void {
	const peers: unknown = entry['transitivePeerDependencies']
	if (!Array.isArray(peers)) return
	entry['transitivePeerDependencies'] = peers
		.map(String)
		.toSorted((left, right) => left.localeCompare(right))
}

// That peer metadata reorders this scope's transitive peer lists; their members still compare.
function sort_peer_lists(document: Record<string, unknown>): void {
	const scoped = mapping_entries(document['snapshots']).filter(([key]) => key.startsWith(SCOPE))

	for (const [, entry] of scoped) sort_peers(entry)
}

// Compare every document, importer, snapshot and resolution. The resolver may only replace this
// scope's tarball locations and registry metadata; versions, integrity and the graph must stay.
function graph(content: string): Array<Record<string, unknown>> {
	const documents = yaml_document.parse_yaml_documents(content)

	for (const document of documents) {
		strip_resolutions(document)
		sort_peer_lists(document)
	}

	return documents
}

function assert_preserved(before: string, after: string): void {
	if (before === '') return

	if (!isDeepStrictEqual(graph(before), graph(after))) {
		throw new Error(
			'Resolution changed the dependency graph or unrelated metadata; no files changed',
		)
	}
}

// --ignore-pnpmfile omits this checksum. Restore only a missing value before the full
// comparison, so changed checksums and all unrelated metadata still fail validation.
function restore_checksum(
	original: Record<string, unknown>,
	resolved: Record<string, unknown>,
): boolean {
	const checksum = original['pnpmfileChecksum']
	if (checksum === undefined || resolved['pnpmfileChecksum'] !== undefined) return false
	resolved['pnpmfileChecksum'] = checksum

	return true
}

function restore_pnpmfile_checksum(before: string, after: string): string {
	const originals = yaml_document.parse_yaml_documents(before)
	const resolved = yaml_document.parse_yaml_documents(after)
	const restored = resolved.map((document, index) =>
		restore_checksum(originals[index] ?? {}, document),
	)
	const prefix = after.startsWith('---') ? '---\n' : ''

	return restored.includes(true)
		? prefix + resolved.map((document) => dump(document)).join('---\n')
		: after
}

const migrate_lock = {
	SCOPE,
	KIT,
	REGISTRY,
	PNPM_VERSION,
	scoped_artifacts,
	npmrc,
	assert_preserved,
	restore_pnpmfile_checksum,
	assert_npm_sources,
	has_npm_sources,
	importer_manifests,
}
export { migrate_lock }
export type { LockedArtifact }
