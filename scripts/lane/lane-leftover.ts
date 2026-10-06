import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readdirSync, readFileSync, readlinkSync, rmSync } from 'node:fs'
import path from 'node:path'
import { git_spawn } from '#scripts/git/git-spawn'

// A lane directory git no longer registers as a work tree (joshuafolkken/kit#2857).
//
// **Nothing else can see it.** `lane:list` and `lane:prune` read `git worktree list`, so a directory
// whose registration is gone is invisible to both, and `git worktree add` refuses its path for good —
// the lane for that issue cannot be opened again until someone deletes it by hand. `lane:open` asks
// here before it adds the tree.
//
// **The test for removing it is that removing it loses nothing**, not a list of names. Every file in
// it has to be one the repository already holds with the same content, so it is a checkout git would
// write again; the one exception is the `.git` file, a pointer to the registration that is gone. A
// list of generated names would break the next time a file is generated, and would delete whatever
// shares one of those names.

// `git ls-tree -r -z`: `<mode> <type> <object>\t<path>`, entries separated by NUL — the `-z` form
// leaves a path with an unusual character unquoted, so it can be compared to the path on disk.
const TREE_ENTRY_PATTERN = /^\d+ blob (?<object>[\da-f]+)\t(?<path>.+)$/su
const GIT_POINTER = '.git'
const GITDIR_PREFIX = 'gitdir: '
// The foreign paths a refusal names before it summarizes the rest as a count.
const NAMED_PATH_LIMIT = 10

// One blob entry as `[path, object id]`; a tree, a commit (a submodule) or the trailing empty entry is
// none.
function tree_entry(entry: string): Array<[string, string]> {
	const { path: entry_path, object } = TREE_ENTRY_PATTERN.exec(entry)?.groups ?? {}

	if (entry_path === undefined || object === undefined) return []

	return [[entry_path, object]]
}

function parse_tree(listing: string): Map<string, string> {
	return new Map(listing.split('\0').flatMap((entry) => tree_entry(entry)))
}

// The object id git gives this file — a symbolic link's is that of its target string, as git stores it.
function blob_id(file: string): string {
	const content = lstatSync(file).isSymbolicLink()
		? Buffer.from(readlinkSync(file))
		: readFileSync(file)

	// SHA-1 because it is git's object id, compared rather than trusted — a repository on the SHA-256
	// object format matches nothing here, so its leftovers are refused rather than removed.
	// eslint-disable-next-line sonarjs/hashing -- git's object id, not a security digest
	return createHash('sha1')
		.update(`blob ${String(content.length)}\0`)
		.update(content)
		.digest('hex')
}

// Walked one level at a time because `readdirSync`'s `recursive` option descends into a symbolic link
// to a directory, which would list the repository's own files under the link's path as foreign.
function walk_files(directory: string, relative: string): Array<string> {
	return readdirSync(path.join(directory, relative), { withFileTypes: true }).flatMap((entry) => {
		const child = relative === '' ? entry.name : `${relative}/${entry.name}`

		return entry.isDirectory() ? walk_files(directory, child) : child
	})
}

// Every file under `directory` as a repository path, symbolic links included and never followed.
function list_files(directory: string): Array<string> {
	return walk_files(directory, '')
}

// The `.git` file is disposable only while the registration it points to is gone: one that still
// resolves is a live work tree — a `lane:open` of the same issue may be checking it out right now.
function is_dangling_pointer(directory: string): boolean {
	const file = path.join(directory, GIT_POINTER)

	if (!lstatSync(file).isFile()) return false

	const pointer = readFileSync(file, 'utf8').trim()

	if (!pointer.startsWith(GITDIR_PREFIX)) return false

	return !existsSync(path.resolve(directory, pointer.slice(GITDIR_PREFIX.length)))
}

function is_reclaimable_file(
	directory: string,
	relative: string,
	tracked: ReadonlyMap<string, string>,
): boolean {
	if (relative === GIT_POINTER) return is_dangling_pointer(directory)

	return tracked.get(relative) === blob_id(path.join(directory, relative))
}

/**
 * The paths under `directory` whose removal would lose something — empty when it holds nothing but
 * the repository's own files and the `.git` pointer. A `.git` directory is a repository of its own,
 * so it is foreign as a whole rather than walked.
 */
function foreign_paths(directory: string, tracked: ReadonlyMap<string, string>): Array<string> {
	const pointer = lstatSync(path.join(directory, GIT_POINTER), { throwIfNoEntry: false })

	if (pointer?.isDirectory() === true) return [GIT_POINTER]

	return list_files(directory).filter(
		(relative) => !is_reclaimable_file(directory, relative, tracked),
	)
}

function refusal(directory: string, foreign: ReadonlyArray<string>): Error {
	const named = foreign.slice(0, NAMED_PATH_LIMIT).join(', ')
	const rest = foreign.length - NAMED_PATH_LIMIT
	const more = rest > 0 ? ` and ${String(rest)} more` : ''

	return new Error(
		`${directory} already exists but git does not register it as a work tree, and it holds files the repository does not: ${named}${more}. It was left in place so nothing is lost — move those files out, delete the directory, and open the lane again.`,
	)
}

/**
 * Clear the way for `git worktree add` at `directory`, which the caller has found unregistered.
 * Absent is nothing to do; holding only the repository's own files, it is removed; anything else is
 * refused with the paths that would have been lost.
 */
async function reclaim(directory: string): Promise<void> {
	if (!existsSync(directory)) return

	const tracked = parse_tree(await git_spawn.read(['ls-tree', '-r', '-z', '--full-tree', 'HEAD']))
	const foreign = foreign_paths(directory, tracked)

	if (foreign.length > 0) throw refusal(directory, foreign)

	rmSync(directory, { force: true, recursive: true })
}

const lane_leftover = {
	blob_id,
	foreign_paths,
	parse_tree,
	reclaim,
}

export { lane_leftover }
