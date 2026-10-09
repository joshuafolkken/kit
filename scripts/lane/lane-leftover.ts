import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readdirSync, readFileSync, readlinkSync, rmSync } from 'node:fs'
import path from 'node:path'
import { ENV_FILE_NAME } from '#ports'
import { git_spawn } from '#scripts/git/git-spawn'
import { IGNORED_CACHE_FILES } from '#scripts/josh/josh-command-types'

// A lane directory git no longer registers as a work tree.
//
// **Nothing else can see it.** `lane:list` and `lane:prune` read `git worktree list`, so a directory
// whose registration is gone is invisible to both, and `git worktree add` refuses its path for good —
// the lane for that issue cannot be opened again until someone deletes it by hand. `lane:open` asks
// here before it adds the tree.
//
// **The test for removing it is that removing it loses nothing**, not a list of names. Every file in
// it has to hold content the repository's history already stores — a blob some ref reaches — so git
// can write it again; the one exception is the `.git` file, a pointer to the registration that is
// gone. **Any commit's content, not only `HEAD`'s at the same path**: a
// leftover is a checkout of whatever commit its lane was on, and measured against `HEAD` the
// leftovers that issue found differed in 167 to 1,431 files each while every one of them was in the
// history. A list of generated names would break the next time a file is generated, and would delete
// whatever shares one of those names.
//
// **The one list of names is what `lane:open` and the gate regenerate**, and only at the top level:
// the install's `node_modules`, the build's `dist`, the `.env` `lane:open` writes from the root's, and
// the gate's caches. A lane carries them on top of its checkout, none is in the history, and walking
// `node_modules` alone would hash tens of thousands of files.
const REGENERATED_PATHS: ReadonlySet<string> = new Set([
	'node_modules',
	'dist',
	ENV_FILE_NAME,
	...IGNORED_CACHE_FILES,
])
const GIT_POINTER = '.git'
const GITDIR_PREFIX = 'gitdir: '
// The foreign paths a refusal names before it summarizes the rest as a count.
const NAMED_PATH_LIMIT = 10

// `git rev-list --objects --all`: one `<object>[ <path>]` line per object any ref reaches — commits,
// trees and blobs alike, which costs nothing here, because only a blob id can equal a file's.
function parse_objects(listing: string): Set<string> {
	return new Set(listing.split('\n').map((line) => line.split(' ', 1)[0] ?? ''))
}

/** Every object id the repository's refs reach — the content a leftover can be restored from. */
async function recoverable_objects(): Promise<Set<string>> {
	return parse_objects(await git_spawn.read(['rev-list', '--objects', '--all']))
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

// Every file under `directory` as a repository path, symbolic links included and never followed —
// less the regenerated top-level entries, which are neither walked nor listed.
function list_files(directory: string): Array<string> {
	return readdirSync(directory)
		.filter((name) => !REGENERATED_PATHS.has(name))
		.flatMap((name) =>
			lstatSync(path.join(directory, name)).isDirectory() ? walk_files(directory, name) : name,
		)
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
	recoverable: ReadonlySet<string>,
): boolean {
	if (relative === GIT_POINTER) return is_dangling_pointer(directory)

	return recoverable.has(blob_id(path.join(directory, relative)))
}

/**
 * The paths under `directory` whose removal would lose something — empty when it holds nothing but
 * content the history stores, the regenerated entries and the `.git` pointer. A `.git` directory is a
 * repository of its own, so it is foreign as a whole rather than walked.
 */
function foreign_paths(directory: string, recoverable: ReadonlySet<string>): Array<string> {
	const pointer = lstatSync(path.join(directory, GIT_POINTER), { throwIfNoEntry: false })

	if (pointer?.isDirectory() === true) return [GIT_POINTER]

	return list_files(directory).filter(
		(relative) => !is_reclaimable_file(directory, relative, recoverable),
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

	const foreign = foreign_paths(directory, await recoverable_objects())

	if (foreign.length > 0) throw refusal(directory, foreign)

	rmSync(directory, { force: true, recursive: true })
}

const lane_leftover = {
	blob_id,
	foreign_paths,
	parse_objects,
	reclaim,
	recoverable_objects,
}

export { lane_leftover }
