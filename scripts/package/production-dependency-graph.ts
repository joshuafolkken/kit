interface LockDependency {
	specifier: string
	version: string
}

interface LockSnapshot {
	dependencies?: Record<string, string>
	optionalDependencies?: Record<string, string>
}

interface LockImporter {
	dependencies: Record<string, LockDependency>
	optionalDependencies?: Record<string, LockDependency>
}

interface Lockfile {
	importers: Record<string, LockImporter>
	snapshots: Record<string, LockSnapshot>
}

function collect_snapshot(
	lockfile: Lockfile,
	names: Set<string>,
	name: string,
	version: string,
): void {
	const key = `${name}@${version}`
	if (names.has(key)) return
	const snapshot = lockfile.snapshots[key]
	if (!snapshot) throw new Error(`Missing production snapshot: ${key}`)
	names.add(key)

	const children = { ...snapshot.dependencies, ...snapshot.optionalDependencies }

	for (const [child, child_version] of Object.entries(children)) {
		collect_snapshot(lockfile, names, child, child_version)
	}
}

function root_version(importer: LockImporter, name: string, specifier: string): string {
	const entry = importer.dependencies[name] ?? importer.optionalDependencies?.[name]
	if (entry?.specifier !== specifier) throw new Error(`Production lockfile mismatch: ${name}`)

	return entry.version
}

function production_names(
	lockfile: Lockfile,
	dependencies: Record<string, string>,
	optional_dependencies: Record<string, string> = {},
): Set<string> {
	const seen = new Set<string>()
	const importer = lockfile.importers['.']
	if (!importer) throw new Error('Missing root importer in production lockfile')

	const roots = { ...dependencies, ...optional_dependencies }

	for (const [name, specifier] of Object.entries(roots)) {
		collect_snapshot(lockfile, seen, name, root_version(importer, name, specifier))
	}

	return new Set([...seen].map((key) => key.slice(0, key.lastIndexOf('@'))))
}

const production_dependency_graph = { names: production_names }

export type { Lockfile }
export { production_dependency_graph }
