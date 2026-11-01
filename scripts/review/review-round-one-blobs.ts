import { existsSync } from 'node:fs'
import path from 'node:path'
import { git_spawn_sync } from '#scripts/git/git-spawn-sync'
import { review_tree } from './review-tree'

// Round 1's files as git blobs, so round 2 can still name the fix delta after the change base moved
// (joshuafolkken/kit#4165).
//
// **A lane merges the default branch between the rounds**, which moves the base, and the round-1 file
// map then covers a different set of paths from the one read now. Its digests cannot be carried onto
// the new base; blobs can. `capture` writes each round-1 path into the object store — nothing else:
// no index, no commit, no ref. `carried_delta` then carries each path three ways — the old base, round
// 1, the new base — and names the paths whose carried content differs from the working tree now. A
// path the default branch alone changed carries to exactly what the merge left, so it drops out; what
// is left is round 1's fixes.
//
// **Every failure answers `undefined`**, which round 2 reads as the moved-base refusal it gave before:
// no recorded blobs, a carry that conflicts, or a git that cannot run one of the reads.

// A path the working tree or a commit does not hold.
const ABSENT = review_tree.ABSENT_DIGEST
const SUCCESS_EXIT_CODE = 0
const NUL = '\0'
const NEWLINE = '\n'
const TAB = '\t'
const SPACE = ' '
const OID_FIELD = 2
const WRITE_FLAGS: ReadonlyArray<string> = ['-w']
const READ_FLAGS: ReadonlyArray<string> = []

interface Move {
	// The base round 1 was read against, and the base now.
	from: string | undefined
	to: string | undefined
	// The paths to read: for a carry, those changed against the base now.
	paths: ReadonlyArray<string>
}

interface CarryInput extends Move {
	// Round 1's blobs, from the snapshot.
	blobs: Record<string, string> | undefined
}

interface Carry {
	blobs: Record<string, string>
	from: string
	to: string
	paths: ReadonlyArray<string>
}

interface Readings {
	blobs: Record<string, string>
	before: Record<string, string>
	after: Record<string, string>
	now: Record<string, string>
}

interface Sides {
	base: string
	round_one: string
	moved: string
}

// git's paths are root-relative, so every command runs from the root rather than the caller's cwd.
function repository_root(): string | undefined {
	return git_spawn_sync.read(['rev-parse', '--show-toplevel'])
}

function hash_paths(
	root: string,
	paths: ReadonlyArray<string>,
	flags: ReadonlyArray<string>,
): Record<string, string> | undefined {
	const present = paths.filter((relative) => existsSync(path.join(root, relative)))
	const output =
		present.length === 0
			? ''
			: git_spawn_sync.read(['hash-object', ...flags, '--', ...present], { cwd: root })

	if (output === undefined) return undefined

	const hashes = output.split(NEWLINE)
	const hashed = new Map(present.map((relative, index) => [relative, hashes[index] ?? ABSENT]))

	return Object.fromEntries(paths.map((relative) => [relative, hashed.get(relative) ?? ABSENT]))
}

// `<mode> <type> <oid>\t<path>`.
function parse_entry(entry: string): [string, string] {
	const tab = entry.indexOf(TAB)

	return [entry.slice(tab + 1), entry.slice(0, tab).split(SPACE)[OID_FIELD] ?? ABSENT]
}

function blobs_at(
	commit: string,
	paths: ReadonlyArray<string>,
	root: string,
): Record<string, string> | undefined {
	const result = git_spawn_sync.run(['ls-tree', '-r', '-z', commit, '--', ...paths], { cwd: root })

	if (result.exit_code !== SUCCESS_EXIT_CODE) return undefined

	return Object.fromEntries(
		result.stdout
			.split(NUL)
			.filter((entry) => entry !== '')
			.map((entry) => parse_entry(entry)),
	)
}

// `git merge-file` exits with the number of conflicts, so only a clean merge answers an oid.
function merged_blob({ base, round_one, moved }: Sides, root: string): string | undefined {
	if ([base, round_one, moved].includes(ABSENT)) return undefined

	return git_spawn_sync.read(['merge-file', '--object-id', round_one, base, moved], { cwd: root })
}

function carried_blob(sides: Sides, root: string): string | undefined {
	if (sides.round_one === sides.base) return sides.moved
	if (sides.moved === sides.base || sides.moved === sides.round_one) return sides.round_one

	return merged_blob(sides, root)
}

// A path round 1 did not list was unchanged against its base, so round 1 held the base's blob.
function sides_of(relative: string, readings: Readings): Sides {
	const base = readings.before[relative] ?? ABSENT

	return {
		base,
		round_one: readings.blobs[relative] ?? base,
		moved: readings.after[relative] ?? ABSENT,
	}
}

// A path's carry: `true` where it reproduces the file now, `false` where it differs, `undefined` where
// git cannot make it — a conflict, or a side that does not hold the path.
function carried_answer(relative: string, readings: Readings, root: string): boolean | undefined {
	const carried = carried_blob(sides_of(relative, readings), root)

	return carried === undefined ? undefined : carried === readings.now[relative]
}

function differing(
	paths: ReadonlyArray<string>,
	readings: Readings,
	root: string,
): ReadonlyArray<string> | undefined {
	const answers = paths.map((relative) => carried_answer(relative, readings, root))

	if (answers.includes(undefined)) return undefined

	return paths.filter((_relative, index) => answers[index] === false)
}

function read_readings(
	input: Carry,
	paths: ReadonlyArray<string>,
	root: string,
): Readings | undefined {
	const before = blobs_at(input.from, paths, root)
	const after = blobs_at(input.to, paths, root)
	const now = hash_paths(root, paths, READ_FLAGS)

	if (before === undefined || after === undefined || now === undefined) return undefined

	return { blobs: input.blobs, before, after, now }
}

// No paths at all is an empty delta: `ls-tree` given none would list the whole tree.
function delta_of(input: Carry, root: string): ReadonlyArray<string> | undefined {
	const paths = [...new Set([...Object.keys(input.blobs), ...input.paths])].toSorted(
		(left, right) => left.localeCompare(right),
	)
	const readings = paths.length === 0 ? undefined : read_readings(input, paths, root)

	if (paths.length === 0) return []

	return readings === undefined ? undefined : differing(paths, readings, root)
}

function carry_of({ blobs, from, to, paths }: CarryInput): Carry | undefined {
	if (blobs === undefined || from === undefined || to === undefined) return undefined

	return { blobs, from, to, paths }
}

function carried_delta(input: CarryInput): ReadonlyArray<string> | undefined {
	const carry = carry_of(input)
	const root = repository_root()

	return carry === undefined || root === undefined ? undefined : delta_of(carry, root)
}

type CarryAnswers = Readonly<Record<string, boolean | undefined>>

function answers_of(carry: Carry, root: string): CarryAnswers | undefined {
	const { paths } = carry
	const readings = paths.length === 0 ? undefined : read_readings(carry, paths, root)

	if (paths.length === 0) return {}
	if (readings === undefined) return undefined

	return Object.fromEntries(
		paths.map((relative) => [relative, carried_answer(relative, readings, root)]),
	)
}

// **Each path's carry on its own** (joshuafolkken/kit#5791): a path git cannot carry answers
// `undefined` for itself, never for the paths beside it, as `carried_delta` does over the whole record.
// `undefined` overall only where there is nothing to carry from or git cannot read the sides.
function carried_each(input: CarryInput): CarryAnswers | undefined {
	const carry = carry_of(input)
	const root = repository_root()

	return carry === undefined || root === undefined ? undefined : answers_of(carry, root)
}

function unmoved_between(
	from: string,
	to: string,
	paths: ReadonlyArray<string>,
	root: string,
): ReadonlyArray<string> | undefined {
	if (from === to || paths.length === 0) return paths
	const before = blobs_at(from, paths, root)
	const after = blobs_at(to, paths, root)

	if (before === undefined || after === undefined) return undefined

	return paths.filter((relative) => (before[relative] ?? ABSENT) === (after[relative] ?? ABSENT))
}

// The paths the base move left alone: there the carry reproduces round 1's file, so the fix delta on
// them is round 1 against the working tree, as on an unmoved base. `undefined` when git cannot say.
function unmoved({ from, to, paths }: Move): ReadonlyArray<string> | undefined {
	const root = repository_root()

	if (root === undefined || from === undefined || to === undefined) return undefined

	return unmoved_between(from, to, paths, root)
}

// Each path's blob, written into the object store so a later carry can merge it; `undefined` when git
// cannot answer, which the record then omits.
function capture(paths: ReadonlyArray<string>): Record<string, string> | undefined {
	const root = repository_root()

	return root === undefined ? undefined : hash_paths(root, paths, WRITE_FLAGS)
}

const review_round_one_blobs = { capture, carried_delta, carried_each, unmoved }

export { review_round_one_blobs }
