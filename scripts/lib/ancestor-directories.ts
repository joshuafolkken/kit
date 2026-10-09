import path from 'node:path'

// One parent-directory walk, in one place. Five modules had each written
// their own — the josh package-root lookup, the gate's project root, the effective-upstream version
// read, the local-bin shim search and the progress-interval read — and they had drifted to three
// different stop conditions. The walk stops at the filesystem root (where `dirname` answers itself)
// or at the first match, and is bounded so a path that never reaches a root — a broken mount, a
// mocked `dirname` — cannot spin.
const MAX_DEPTH = 64

// The directory itself and each of its ancestors up to the filesystem root, nearest-first.
function list(start_directory: string): ReadonlyArray<string> {
	const directories: Array<string> = []
	let current = path.resolve(start_directory)

	while (directories.length < MAX_DEPTH && !directories.includes(current)) {
		directories.push(current)
		current = path.dirname(current)
	}

	return directories
}

// The nearest directory, the start included, that `is_match` accepts — undefined when the walk
// reaches the root without one.
function nearest(
	start_directory: string,
	is_match: (directory: string) => boolean,
): string | undefined {
	return list(start_directory).find((directory) => is_match(directory))
}

const ancestor_directories = { list, nearest }

export { ancestor_directories }
