import { isDeepStrictEqual } from 'node:util'
import { loadAll } from 'js-yaml'
import { z } from 'zod'
import { whole_suite_files } from './whole-suite-files'

// **`pnpm-lock.yaml` is a whole-suite file only for what moves every test** (joshuafolkken/kit#7554). A
// change resolving other versions of some packages reaches the modules importing them — and, through
// `vitest related`, their tests — rather than every test. The packages it moved are the entries of
// `packages` / `snapshots` that differ, with every package depending on one of them, however far. The
// whole suite still runs when either side cannot be read, when anything else moved — an importer's
// specifier or dependency, an override, a setting — or when a unit runtime package moved
// (`whole_suite_files.is_unit_runtime_package`).

const LOCKFILE_PATH = 'pnpm-lock.yaml'
const VERSION_KEY = 'version'
const SCOPE_PREFIX = '@'
const DEPENDENCY_GROUPS = ['dependencies', 'optionalDependencies'] as const
const RESOLUTION_KEYS: ReadonlySet<string> = new Set(['importers', 'packages', 'snapshots'])

const entries_schema = z.record(z.string(), z.unknown()).default({})
const document_schema = z.looseObject({
	importers: entries_schema,
	packages: entries_schema,
	snapshots: entries_schema,
})
const snapshot_schema = z.looseObject({
	dependencies: entries_schema,
	optionalDependencies: entries_schema,
})

type LockfileDocument = z.infer<typeof document_schema>
type Entries = Readonly<Record<string, unknown>>

function documents_of(text: string): Array<LockfileDocument> | undefined {
	try {
		return loadAll(text).map((document) => document_schema.parse(document))
	} catch {
		return undefined
	}
}

// A snapshot key carries the peer suffix (`name@1.0.0(peer@2.0.0)`); its package key does not.
function to_package_key(snapshot_key: string): string {
	const peer_start = snapshot_key.indexOf('(', 1)

	return peer_start === -1 ? snapshot_key : snapshot_key.slice(0, peer_start)
}

// `name@1.0.0(peer@2.0.0)` → `name`; a scoped name keeps its leading `@`.
function name_of(key: string): string {
	const package_key = to_package_key(key)
	const at = package_key.indexOf(SCOPE_PREFIX, 1)

	return at === -1 ? package_key : package_key.slice(0, at)
}

function without_versions(value: unknown): unknown {
	if (Array.isArray(value)) return value.map((item: unknown) => without_versions(item))
	if (typeof value !== 'object' || value === null) return value

	const kept = Object.entries(value).filter(([key]) => key !== VERSION_KEY)

	return Object.fromEntries(kept.map(([key, item]) => [key, without_versions(item)]))
}

// What a document holds besides its resolutions: a change here is no resolution of other versions.
function skeleton_of(document: LockfileDocument): unknown {
	const rest = Object.entries(document).filter(([key]) => !RESOLUTION_KEYS.has(key))

	return { ...Object.fromEntries(rest), importers: without_versions(document.importers) }
}

function moved_keys(before: Entries, after: Entries): Array<string> {
	const keys = new Set([...Object.keys(before), ...Object.keys(after)])

	return [...keys].filter((key) => !isDeepStrictEqual(before[key], after[key]))
}

function dependency_names(snapshot: unknown): Array<string> {
	const parsed = snapshot_schema.safeParse(snapshot ?? {})
	if (!parsed.success) return []

	return DEPENDENCY_GROUPS.flatMap((group) => Object.keys(parsed.data[group]))
}

// Each package name with the names of the packages depending on it.
function dependents_of(documents: ReadonlyArray<LockfileDocument>): Map<string, Set<string>> {
	const dependents = new Map<string, Set<string>>()
	const snapshots = documents.flatMap((document) => Object.entries(document.snapshots))
	const edges = snapshots.flatMap(([key, snapshot]) =>
		dependency_names(snapshot).map((name) => [name, name_of(key)] as const),
	)

	for (const [name, dependent] of edges) {
		dependents.set(name, (dependents.get(name) ?? new Set()).add(dependent))
	}

	return dependents
}

function with_dependents(
	moved: ReadonlyArray<string>,
	dependents: ReadonlyMap<string, ReadonlySet<string>>,
): Set<string> {
	const reached = new Set(moved)
	const pending = [...reached]

	for (let name = pending.pop(); name !== undefined; name = pending.pop()) {
		const unseen = [...(dependents.get(name) ?? [])].filter((dependent) => !reached.has(dependent))

		for (const dependent of unseen) reached.add(dependent)
		pending.push(...unseen)
	}

	return reached
}

function moved_names(was: LockfileDocument, is: LockfileDocument): Array<string> {
	return [...moved_keys(was.packages, is.packages), ...moved_keys(was.snapshots, is.snapshots)].map(
		(key) => name_of(key),
	)
}

function is_resolution_only(
	was: ReadonlyArray<LockfileDocument>,
	is: ReadonlyArray<LockfileDocument>,
): boolean {
	if (was.length !== is.length) return false

	return was.every((document, index) => {
		const other = is[index]

		return other !== undefined && isDeepStrictEqual(skeleton_of(document), skeleton_of(other))
	})
}

// The packages the change from `before` to `after` moved, with every package depending on one —
// `undefined` when the change reaches every test.
function affected_packages(before: string, after: string): ReadonlySet<string> | undefined {
	const was = documents_of(before)
	const is = documents_of(after)

	if (was === undefined || is === undefined || !is_resolution_only(was, is)) return undefined

	const moved = was.flatMap((document, index) => moved_names(document, is[index] ?? document))
	const reached = with_dependents(moved, dependents_of([...was, ...is]))

	return [...reached].some((name) => whole_suite_files.is_unit_runtime_package(name))
		? undefined
		: reached
}

const lockfile_changed_packages = { LOCKFILE_PATH, affected_packages, to_package_key }

export { lockfile_changed_packages }
