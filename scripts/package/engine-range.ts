import { loadAll } from 'js-yaml'
import semver from 'semver'
import { z } from 'zod'

interface EngineConflict {
	key: string
	range: string
}

const package_schema = z.looseObject({
	engines: z.looseObject({ node: z.string().optional() }).optional(),
})
const snapshot_schema = z.looseObject({ optional: z.boolean().optional() }).nullable()
const document_schema = z.looseObject({
	packages: z.record(z.string(), package_schema).default({}),
	snapshots: z.record(z.string(), snapshot_schema).default({}),
})

type LockfileDocument = z.infer<typeof document_schema>

// A snapshot key carries the peer suffix (`name@1.0.0(peer@2.0.0)`); its package key does not.
function to_package_key(snapshot_key: string): string {
	const peer_start = snapshot_key.indexOf('(', 1)

	return peer_start === -1 ? snapshot_key : snapshot_key.slice(0, peer_start)
}

// pnpm skips an optional package whose engines the running Node fails instead of failing the
// install, so only a package some non-optional snapshot reaches can refuse an install.
function collect_required_keys(document: LockfileDocument): Set<string> {
	const required_snapshots = Object.entries(document.snapshots).filter(
		([, snapshot]) => snapshot?.optional !== true,
	)

	return new Set(required_snapshots.map(([key]) => to_package_key(key)))
}

function find_document_conflicts(
	declared: string,
	document: LockfileDocument,
): Array<EngineConflict> {
	const required = collect_required_keys(document)
	const ranged = Object.entries(document.packages).map(([key, entry]) => ({
		key,
		range: entry.engines?.node ?? '*',
	}))

	return ranged.filter(({ key, range }) => required.has(key) && !semver.subset(declared, range))
}

// pnpm 11 and 12 write pnpm-lock.yaml as a multi-document stream (the pnpm self-management
// document precedes the project document), so every document is read.
function find_conflicts(declared: string, lockfile_raw: string): Array<EngineConflict> {
	return loadAll(lockfile_raw).flatMap((document) =>
		find_document_conflicts(declared, document_schema.parse(document)),
	)
}

const engine_range = { find_conflicts }

export type { EngineConflict }
export { engine_range }
