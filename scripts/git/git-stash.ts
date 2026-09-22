import { git_spawn } from './git-spawn'

// The one place a sanctioned `git stash pop` is targeted by its message rather than its stack
// position (joshuafolkken/kit#2050). The stash is a single repository-wide stack shared by every
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
// it runs; `dir` is what makes the pop land in the lane's tree rather than the primary checkout —
// the `git -C <dir>` a lane child used to write by hand.
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
		git_args(directory, ['diff', '--name-only', '--diff-filter=U']),
	)

	return unmerged !== ''
}

const git_stash = {
	has_conflict,
	list,
	matches,
	parse_entries,
	pop,
	select,
}

export type { Selection }
export { git_stash }
