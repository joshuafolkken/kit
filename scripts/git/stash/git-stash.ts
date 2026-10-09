import { git_spawn } from '#scripts/git/git-spawn'

// The one place a sanctioned `git stash pop` is targeted by its message rather than its stack
// position. The stash is a single repository-wide stack shared by every
// working tree of the repository, so a bare `git stash pop` — or a positional `stash@{n}` read
// before another lane pushed — pops whatever now sits on top, which is how one lane's parked work
// ended up in another lane's tree. Resolving the selector from the message the stash was pushed
// with, immediately before the pop, targets the entry itself rather than a position that moves.

const ENTRY_SEPARATOR = '\n'
// A NUL between the two fields, because the subject carries the spaces and colons a message repeats.
const FIELD_SEPARATOR = '\u{0}'
// `%gd` is the selector (`stash@{0}`), `%gs` the reflog subject (`On <branch>: <message>` for a
// stash pushed with `-m`); `%x00` emits the NUL the fields are split on.
const LIST_FORMAT = '--format=%gd%x00%gs'
const SUBJECT_MESSAGE_SEPARATOR = ': '
// `%H` is the entry's commit hash; the second format pairs it with the position a drop needs.
const HASH_FORMAT = '--format=%H%x00%gs'
const HASH_POSITION_FORMAT = '--format=%H%x00%gd'
const NAME_ONLY_FLAG = '--name-only'
const ADDED_PREFIX = '+'
const FILE_HEADER_PREFIX = '+++'

interface StashEntry {
	selector: string
	subject: string
}

type Selection =
	| { kind: 'match'; selector: string }
	| { kind: 'none' }
	| { kind: 'ambiguous'; selectors: ReadonlyArray<string> }

function to_entry(line: string): StashEntry | undefined {
	const [selector, subject] = line.split(FIELD_SEPARATOR)

	if (selector === undefined || subject === undefined) return undefined

	return { selector, subject }
}

function parse_entries(raw: string): Array<StashEntry> {
	if (raw === '') return []

	return raw
		.split(ENTRY_SEPARATOR)
		.map((line) => to_entry(line))
		.filter((entry): entry is StashEntry => entry !== undefined)
}

// A stash pushed with `-m "<message>"` lists as `On <branch>: <message>`, and one pushed by a step
// that gave no branch context lists as `<message>` verbatim. Both are matched, and the `: ` suffix
// test keeps `#20` from matching a message that merely ends in `#200`.
function matches(subject: string, message: string): boolean {
	return subject === message || subject.endsWith(`${SUBJECT_MESSAGE_SEPARATOR}${message}`)
}

function select(entries: ReadonlyArray<StashEntry>, message: string): Selection {
	const found = entries.filter((entry) => matches(entry.subject, message))

	const [first] = found

	if (first === undefined) return { kind: 'none' }

	if (found.length > 1) {
		return { kind: 'ambiguous', selectors: found.map((entry) => entry.selector) }
	}

	return { kind: 'match', selector: first.selector }
}

// The stash is a repository-level stack every work tree shares, so the list reads the same wherever
// it runs; `dir` is what makes the pop land in the lane's tree rather than the primary checkout.
function git_args(directory: string | undefined, args: Array<string>): Array<string> {
	return directory === undefined ? args : ['-C', directory, ...args]
}

async function list(directory?: string): Promise<Array<StashEntry>> {
	return parse_entries(await git_spawn.read(git_args(directory, ['stash', 'list', LIST_FORMAT])))
}

async function pop(selector: string, directory?: string): Promise<void> {
	await git_spawn.read(git_args(directory, ['stash', 'pop', selector]))
}

// `git stash pop` on a content conflict applies the entry, keeps it on the stack, and exits non-zero
// — the resume path documented in `backlogrun-park.md` ("expect to resolve conflicts"). The non-zero
// exit is indistinguishable from a real failure by its code alone, so a conflicted pop is told apart
// by the unmerged paths it leaves: `--diff-filter=U` lists exactly those, empty on any other failure.
async function has_conflict(directory?: string): Promise<boolean> {
	const unmerged = await git_spawn.read(
		git_args(directory, ['diff', NAME_ONLY_FLAG, '--diff-filter=U']),
	)

	return unmerged !== ''
}

// Uncommitted work is anything `git status --porcelain` lists — untracked files included, which is what
// `push` below carries with `-u`, so the two agree on what "work" means.
async function has_changes(directory?: string): Promise<boolean> {
	return (await git_spawn.read(git_args(directory, ['status', '--porcelain']))) !== ''
}

// Push with a message `josh stash:pop` can later target — the stack is shared by every work tree, so an
// entry pushed from a lane outlives the lane's own tree.
async function push(message: string, directory?: string): Promise<void> {
	await git_spawn.read(git_args(directory, ['stash', 'push', '-u', '-m', message]))
}

// The stack keyed by commit rather than position: a sweep that reads the
// stack, asks GitHub about each entry and only then drops one would drop whatever another lane pushed
// on top in the meantime if it kept the `stash@{n}` it read first. The `selector` of each entry here is
// its commit hash, which never moves.
async function list_by_hash(directory?: string): Promise<Array<StashEntry>> {
	return parse_entries(await git_spawn.read(git_args(directory, ['stash', 'list', HASH_FORMAT])))
}

// The paths an entry carries, untracked files included — `push` stashes with `-u`.
async function changed_paths(hash: string, directory?: string): Promise<Array<string>> {
	const raw = await git_spawn.read(
		git_args(directory, ['stash', 'show', '--include-untracked', NAME_ONLY_FLAG, hash]),
	)

	return raw === '' ? [] : raw.split(ENTRY_SEPARATOR)
}

// A path untracked when the entry was pushed with `-u` lives in its third parent, not in its diff, so
// every line of it is an added one; a path absent from that parent reads as none.
async function untracked_lines(
	hash: string,
	file: string,
	directory?: string,
): Promise<Array<string>> {
	try {
		const raw = await git_spawn.read(git_args(directory, ['show', `${hash}^3:${file}`]))

		return raw === '' ? [] : raw.split(ENTRY_SEPARATOR)
	} catch {
		return []
	}
}

// The lines an entry adds to one path, as a unified diff against the commit it was pushed on — or, for
// a path that was untracked then, the whole file.
async function added_lines(hash: string, file: string, directory?: string): Promise<Array<string>> {
	const diff = await git_spawn.read(git_args(directory, ['diff', `${hash}^1`, hash, '--', file]))

	if (diff === '') return await untracked_lines(hash, file, directory)

	return diff
		.split(ENTRY_SEPARATOR)
		.filter((line) => line.startsWith(ADDED_PREFIX) && !line.startsWith(FILE_HEADER_PREFIX))
		.map((line) => line.slice(ADDED_PREFIX.length))
}

// The position is resolved from the hash immediately before the drop, so an entry pushed since the
// sweep's read cannot be dropped in its place; an entry already gone answers `false` rather than
// throwing. Sweeps are serialized by `stash-sweep-lock`, but a plain `git stash push` or `pop` from
// another command landing between the resolve and the drop still shifts the position — that window is
// the length of two local git calls.
async function drop_by_hash(hash: string, directory?: string): Promise<boolean> {
	const raw = await git_spawn.read(git_args(directory, ['stash', 'list', HASH_POSITION_FORMAT]))
	const entry = parse_entries(raw).find((candidate) => candidate.selector === hash)

	if (entry === undefined) return false

	await git_spawn.read(git_args(directory, ['stash', 'drop', entry.subject]))

	return true
}

// The message uncommitted work is pushed with, keyed on the issue so `josh stash:pop` can target it and
// on the occasion so two pushes for one issue — a lane close and an `already-done` read — stay apart.
function work_message(issue: string, occasion: string): string {
	return `${issue}: uncommitted work at ${occasion}`
}

const git_stash = {
	added_lines,
	changed_paths,
	drop_by_hash,
	has_changes,
	has_conflict,
	list,
	list_by_hash,
	matches,
	parse_entries,
	pop,
	push,
	select,
	work_message,
}

export type { Selection, StashEntry }
export { git_stash }
