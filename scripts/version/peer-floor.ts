import semver from 'semver'
import { z } from 'zod'

// A package built on a toolkit publishes its own `peerDependencies`, and a toolkit raising a peer
// floor edits nobody's manifest but its own. `josh latest` rewrites `dependencies` and
// `devDependencies` only, so the consumer keeps declaring a floor it no longer develops or verifies
// against: a user on a version between the two floors satisfies the consumer's declaration and
// breaks the toolkit's.

interface LaggingPeer {
	name: string
	range: string
	/** The installed toolkit as `name@version`, so the reader knows which release set the floor. */
	toolkit: string
	toolkit_range: string
}

const peer_manifest_schema = z.looseObject({
	name: z.string().optional(),
	version: z.string().optional(),
	peerDependencies: z.record(z.string(), z.string()).optional(),
})

type PeerManifest = z.infer<typeof peer_manifest_schema>

function parse_manifest(package_json_content: string): PeerManifest {
	return peer_manifest_schema.parse(JSON.parse(package_json_content))
}

// A range semver cannot read (`workspace:*`, `catalog:`) has no floor to compare, and neither does
// one nothing can satisfy; both answer "not below" rather than inventing a violation.
function is_floor_below(range: string, toolkit_range: string): boolean {
	if (semver.validRange(range) === null || semver.validRange(toolkit_range) === null) return false

	const floor = semver.minVersion(range)
	const toolkit_floor = semver.minVersion(toolkit_range)

	if (floor === null || toolkit_floor === null) return false

	return semver.lt(floor, toolkit_floor)
}

function toolkit_label(toolkit: PeerManifest): string {
	return [toolkit.name, toolkit.version].filter((part) => part !== undefined).join('@')
}

function to_lagging_peer(
	[name, range]: [string, string],
	toolkit: PeerManifest,
): Array<LaggingPeer> {
	const toolkit_range = toolkit.peerDependencies?.[name]

	if (toolkit_range === undefined || !is_floor_below(range, toolkit_range)) return []

	return [{ name, range, toolkit: toolkit_label(toolkit), toolkit_range }]
}

// A toolkit's own manifest is never compared with itself: there it is the source of the floors, not
// a consumer of them.
function find_lagging_against(manifest: PeerManifest, toolkit: PeerManifest): Array<LaggingPeer> {
	if (manifest.name === toolkit.name) return []

	return Object.entries(manifest.peerDependencies ?? {}).flatMap((entry) =>
		to_lagging_peer(entry, toolkit),
	)
}

// Every installed toolkit is compared, not kit alone: a package built on app-kit inherits app-kit's
// floors exactly as app-kit inherits kit's, and the gap is the same one a tier up.
function find_lagging(
	package_json_content: string,
	toolkit_json_contents: ReadonlyArray<string>,
): Array<LaggingPeer> {
	const manifest = parse_manifest(package_json_content)

	return toolkit_json_contents.flatMap((content) =>
		find_lagging_against(manifest, parse_manifest(content)),
	)
}

function format_lagging(peer: LaggingPeer): string {
	return `   ${peer.name}@${peer.range} — ${peer.toolkit} requires ${peer.toolkit_range}`
}

function format_failure(lagging: ReadonlyArray<LaggingPeer>): string {
	return [
		`\n✖ ${String(lagging.length)} published peer range(s) fall below an installed toolkit's:`,
		...lagging.map((peer) => format_lagging(peer)),
		'',
		'   A user inside the gap satisfies this package and breaks the toolkit it is built on, so the',
		'   declaration promises a combination nobody verified. Raise each `peerDependencies` floor',
		'   in package.json to the range the toolkit requires.',
	].join('\n')
}

const peer_floor = { find_lagging, format_failure }

export { peer_floor }
export type { LaggingPeer }
