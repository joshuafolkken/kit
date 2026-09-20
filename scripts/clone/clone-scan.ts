import { existsSync, readdirSync, readFileSync, type Dirent } from 'node:fs'
import path from 'node:path'
import { repo_discovery } from '#scripts/discovery/repo-discovery'
import {
	clone_aggregate,
	type CloneGroup,
	type CloneSite,
	type Fingerprint,
} from './clone-aggregate'
import { clone_fingerprint } from './clone-fingerprint'

// Walking the source trees and reporting the clones (joshuafolkken/kit#2217).
//
// The current repository is always scanned; every first-party sibling `repo_discovery` finds —
// including the ones `JOSH_REPO_PATHS` adds — is scanned too, so a copy that crossed a package
// boundary is counted rather than left invisible. A repository is identified by its absolute root,
// which is what makes two identical relative paths in different repositories a cross-repository clone.

// The directories a package keeps its source in; whichever exist are scanned.
const SOURCE_ROOTS = ['scripts', 'src']
const SOURCE_EXTENSION = '.ts'
// Test files and declarations are not product code, so a shared test helper is not a clone to report.
const IGNORED_SUFFIXES = ['.test.ts', '.svelte.test.ts', '.d.ts']
const IGNORED_DIRECTORIES = new Set(['node_modules', '.git', '.svelte-kit', 'dist', 'build'])
const CLEAN_VERDICT = 'clean'
const CLONES_PREFIX = 'clones:'

// Whether a filename is a source file worth fingerprinting.
function is_source_file(name: string): boolean {
	if (!name.endsWith(SOURCE_EXTENSION)) return false

	return IGNORED_SUFFIXES.every((suffix) => !name.endsWith(suffix))
}

// Whether a directory entry is one to descend into.
function is_scannable_directory(entry: Dirent): boolean {
	return entry.isDirectory() && !IGNORED_DIRECTORIES.has(entry.name)
}

// The directory's entries, or none when it cannot be read: an unreadable directory is reported empty
// rather than failing the whole scan.
function read_entries(directory: string): Array<Dirent> {
	try {
		return readdirSync(directory, { withFileTypes: true })
	} catch {
		return []
	}
}

// The source files directly in a directory (not its subdirectories).
function direct_source_files(directory: string, entries: ReadonlyArray<Dirent>): Array<string> {
	return entries
		.filter((entry) => entry.isFile() && is_source_file(entry.name))
		.map((entry) => path.join(directory, entry.name))
}

// Every source file under a directory, recursively. Only `walk` recurses, so there is no forward
// reference to resolve.
function walk(directory: string): Array<string> {
	const entries = read_entries(directory)
	const nested = entries
		.filter((entry) => is_scannable_directory(entry))
		.flatMap((entry) => walk(path.join(directory, entry.name)))

	return [...direct_source_files(directory, entries), ...nested]
}

// Every source file across a repository's source roots.
function source_files(repo_path: string): Array<string> {
	return SOURCE_ROOTS.map((root) => path.join(repo_path, root))
		.filter((root) => existsSync(root))
		.flatMap((root) => walk(root))
}

// The fingerprints of one file, keyed to its repository and repo-relative path. An unreadable file
// contributes none.
function file_fingerprints(repo_path: string, file: string): Array<Fingerprint> {
	try {
		const source = readFileSync(file, 'utf8')

		return clone_fingerprint.fingerprints_for(source, {
			repo: repo_path,
			file: path.relative(repo_path, file),
		})
	} catch {
		return []
	}
}

// Every fingerprint of every source file in a repository.
function repo_fingerprints(repo_path: string): Array<Fingerprint> {
	return source_files(repo_path).flatMap((file) => file_fingerprints(repo_path, file))
}

// A repository's identity: its `origin` remote, or its resolved path when it declares none. Two
// worktrees of one repository share an `origin`, so this is what collapses them to a single scan —
// without it a lane sitting beside its sibling lanes would report every identical line as a clone.
function repo_identity(repo_path: string): string {
	return repo_discovery.read_origin_url(repo_path) ?? path.resolve(repo_path)
}

// The absolute roots to scan: the current repository plus every first-party repository discovered
// beside it, de-duplicated by identity — the current tree wins, so a worktree of it is dropped — so
// each repository is scanned exactly once.
function scan_roots(root: string): Array<string> {
	const map = repo_discovery.discover_repositories(root)
	const seen = new Set<string>()
	const roots: Array<string> = []

	for (const repo_path of [root, ...map.values()]) {
		const identity = repo_identity(repo_path)
		if (seen.has(identity)) continue

		seen.add(identity)
		roots.push(path.resolve(repo_path))
	}

	return roots
}

// The clones found across the current repository and its first-party siblings.
function scan(root: string): Array<CloneGroup> {
	const fingerprints = scan_roots(root).flatMap((repo_path) => repo_fingerprints(repo_path))

	return clone_aggregate.aggregate(fingerprints)
}

// One site as `<repo>/<file>:<line>`; the repository basename disambiguates a cross-repository clone.
function format_site(site: CloneSite): string {
	return `${path.basename(site.repo)}/${site.file}:${String(site.line)}`
}

// One clone group: its category and every site it occurs at.
function format_group(group: CloneGroup): string {
	return `  [${group.category}] ${group.sites.map((site) => format_site(site)).join(', ')}`
}

// The report: `clean` when nothing duplicated, otherwise the count and each clone's sites.
function format_report(groups: ReadonlyArray<CloneGroup>): string {
	if (groups.length === 0) return CLEAN_VERDICT

	const header = `${CLONES_PREFIX} ${String(groups.length)}`

	return [header, ...groups.map((group) => format_group(group))].join('\n')
}

const clone_scan = { CLEAN_VERDICT, CLONES_PREFIX, scan, format_site, format_group, format_report }

export { clone_scan }
