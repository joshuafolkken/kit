import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { file_map_stamp, type FileMapStamp } from '#scripts/josh/file-map-stamp'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { review_brief } from './review-brief'
import { review_brief_cli } from './review-brief-cli'
import { review_tree } from './review-tree'

// joshuafolkken/kit#1241: `/code-review` runs in a forked process that reads none of this
// repository's documents, so everything the run already knows reaches it only as the invocation
// argument. Measured on joshuafolkken/kit#1240 — both rounds re-ran the unit suite `josh gate` had
// just passed, both fumbled the runner, and round 2 re-read the whole diff.
//
// The two halves are tested apart because they are not the same kind of thing: the round-2 target is
// mechanical (a digest comparison decides the scope), while the "already verified" block is only an
// instruction to an agent that has a shell.

const TAKEN_AT = '2026-09-03T01:00:00.000Z'
const LEVEL = 'medium'
const FILE_A = 'a.ts'
const FILE_B = 'b.md'
const FILE_C = 'c.ts'
const EDITED = 'edited'
const VERIFIED = 'Already verified'
const NOT_VERIFIED = 'Not verified'
const RUNNING = 'Running now'
// The second record's own timestamp, so a test can tell which of the two a line was composed from.
const STARTED_AT = '2026-09-03T02:00:00.000Z'

type Tree = Record<string, string>

function stamp_of(files: Tree): FileMapStamp {
	return { taken_at: TAKEN_AT, files }
}

// A marker asserts a live process, so the fixture carries this one: without a pid the reader answers
// "not running", which is the stale case rather than the running one.
function started_stamp_of(files: Tree): FileMapStamp {
	return { taken_at: STARTED_AT, files, pid: process.pid }
}

// A pid above every platform's ceiling, so the liveness probe can only report it gone. Reusing a real
// one that has exited would be a race against the operating system reassigning it.
const DEAD_PID = 2_147_483_646

function stale_stamp_of(files: Tree): FileMapStamp {
	return { taken_at: STARTED_AT, files, pid: DEAD_PID }
}

function compose(input: {
	round: number
	tree: Record<string, string>
	gate?: FileMapStamp
	in_flight?: FileMapStamp
	round_one?: FileMapStamp
}): string {
	return review_brief.compose({
		level: LEVEL,
		round: input.round,
		tree: input.tree,
		stamps: { gate: input.gate, in_flight: input.in_flight, round_one: input.round_one },
	})
}

function gate_line(input: { gate?: FileMapStamp; in_flight?: FileMapStamp }, tree: Tree): string {
	return review_brief.gate_line({ gate: input.gate, in_flight: input.in_flight }, tree)
}

describe('review_brief.compose — the level stays first', () => {
	// `review:level`'s contract is that `$(pnpm josh review:level)` reads the answer. A brief that
	// buried the level under a heading would break every caller that already reads it that way.
	it('puts the level alone on the first line', () => {
		expect(compose({ round: 1, tree: { [FILE_A]: 'x' } }).split('\n', 1)[0]).toBe(LEVEL)
	})

	it('always names the project test command', () => {
		expect(compose({ round: 1, tree: {} })).toContain(review_brief.TEST_COMMAND_LINE)
	})
})

describe('review_brief.gate_line — never claims a gate that did not run on this tree', () => {
	const tree = { [FILE_A]: 'x', [FILE_B]: 'y' }

	it('claims green when the stamp covers exactly this tree', () => {
		const line = gate_line({ gate: stamp_of(tree) }, tree)

		expect(line).toContain(VERIFIED)
		expect(line).toContain(TAKEN_AT)
	})

	// The whole reason the record carries digests: a gate that passed before the fixes says nothing
	// about the tree the review is about to read.
	it('refuses to claim green when a file changed after the gate', () => {
		const line = gate_line({ gate: stamp_of(tree) }, { ...tree, [FILE_A]: EDITED })

		expect(line).toContain(NOT_VERIFIED)
		expect(line).not.toContain(VERIFIED)
	})

	it('refuses to claim green when a file was added after the gate', () => {
		expect(gate_line({ gate: stamp_of(tree) }, { ...tree, [FILE_C]: 'new' })).toContain(
			NOT_VERIFIED,
		)
	})

	it('refuses to claim green when there is no record at all', () => {
		expect(gate_line({}, tree)).toContain(NOT_VERIFIED)
	})
})

// joshuafolkken/kit#1242: the gate and the review are started together, so at the moment the brief is
// composed the checks are usually still running. Without a third state that is indistinguishable from
// "no gate was ever run", and the review agent re-runs the unit suite the gate is running beside it —
// the exact cost joshuafolkken/kit#1241 had just removed.
describe('review_brief.gate_line — a gate still running is its own state', () => {
	const tree = { [FILE_A]: 'x', [FILE_B]: 'y' }

	it('says a gate is running when the marker covers exactly this tree', () => {
		const line = gate_line({ in_flight: started_stamp_of(tree) }, tree)

		expect(line).toContain(RUNNING)
		expect(line).toContain(STARTED_AT)
	})

	// The distinction the whole state exists for. A gate that has not finished has no result, so the
	// sentence forbids the re-run without asserting a pass — and a reader scanning for "verified"
	// must not find it here.
	it('claims no result while the gate is running', () => {
		const line = gate_line({ in_flight: started_stamp_of(tree) }, tree)

		expect(line).not.toContain(VERIFIED)
		expect(line).toContain('Nothing here claims any of them are green')
	})

	// A marker left behind by a gate that ended before these edits describes a different tree, and the
	// safe answer is the same one a stale green stamp gets.
	it('falls back to not-verified when the marker predates an edit', () => {
		const line = gate_line({ in_flight: started_stamp_of(tree) }, { ...tree, [FILE_A]: EDITED })

		expect(line).toContain(NOT_VERIFIED)
		expect(line).not.toContain(RUNNING)
	})

	// A proven result outranks a running one. The tree has not moved, so the green stamp is still true
	// and a second gate over it can only reach the same answer.
	it('prefers a matching green stamp over a running gate', () => {
		const line = gate_line({ gate: stamp_of(tree), in_flight: started_stamp_of(tree) }, tree)

		expect(line).toContain(VERIFIED)
		expect(line).not.toContain(RUNNING)
	})

	it('reaches the composed brief', () => {
		expect(compose({ round: 1, tree, in_flight: started_stamp_of(tree) })).toContain(RUNNING)
	})

	// `josh gate` clears the marker in a `finally`, and a `finally` does not run when the gate is
	// killed — Ctrl-C, Stop, SIGTERM. The file is then left behind describing the very tree it was
	// reading, so the digests still match and only the process is gone; believed on the digests alone
	// the brief would report a gate running for as long as nobody edits that tree.
	it('falls back to not-verified when the marker outlived the gate that wrote it', () => {
		const line = gate_line({ in_flight: stale_stamp_of(tree) }, tree)

		expect(line).toContain(NOT_VERIFIED)
		expect(line).not.toContain(RUNNING)
	})

	// A record written before the pid existed cannot be checked for liveness, so it is read as stale
	// rather than trusted — the same direction every other missing record takes.
	it('falls back to not-verified when the marker carries no process at all', () => {
		expect(gate_line({ in_flight: stamp_of(tree) }, tree)).toContain(NOT_VERIFIED)
	})
})

describe('review_brief — round 2 is scoped by comparison, not by recall', () => {
	const before = { [FILE_A]: 'x', [FILE_B]: 'y', [FILE_C]: 'z' }
	const after = { ...before, [FILE_A]: EDITED }

	it('names only the files the fixes changed', () => {
		const brief = compose({ round: 2, tree: after, round_one: stamp_of(before) })

		expect(brief).toContain(review_brief.ROUND_TWO_HEADING)
		expect(brief).toContain(FILE_A)
		expect(brief).not.toContain(FILE_B)
		expect(brief).not.toContain(FILE_C)
	})

	it("asks the verification question rather than the first round's", () => {
		expect(compose({ round: 2, tree: after, round_one: stamp_of(before) })).toContain(
			review_brief.ROUND_TWO_QUESTION,
		)
	})

	// A missing record must widen the review, never narrow it: a brief that silently reviewed nothing
	// would be the cheapest possible run and the most dangerous.
	it('falls back to the whole change when no snapshot was recorded', () => {
		const brief = compose({ round: 2, tree: after })

		expect(brief).toContain(review_brief.NO_SNAPSHOT_LINE)
		expect(brief).toContain(review_brief.WHOLE_CHANGE_TARGET)
	})

	it('says so when nothing changed since round 1', () => {
		expect(compose({ round: 2, tree: before, round_one: stamp_of(before) })).toContain(
			review_brief.EMPTY_DELTA_LINE,
		)
	})

	it('reviews the whole change on round 1', () => {
		expect(compose({ round: 1, tree: before })).toContain(review_brief.WHOLE_CHANGE_TARGET)
	})
})

describe('review_brief_cli.parse_round', () => {
	it.each([
		[[], 1],
		[['--round', '1'], 1],
		[['--round', '2'], 2],
	])('reads %j as round %i', (argv, expected) => {
		expect(review_brief_cli.parse_round(argv)).toBe(expected)
	})

	// A misspelled flag that fell through to a default would hand round 2 the whole diff, which is the
	// scope this command exists to narrow — so every unrecognized form is a usage error.
	it.each([[['--round']], [['--round', '3']], [['--round', '2x']], [['--rounds', '2']], [['2']]])(
		'refuses %j',
		(argv) => {
			expect(review_brief_cli.parse_round(argv)).toBeUndefined()
		},
	)
})

describe('review_tree.tree_of', () => {
	let root = ''

	beforeEach(() => {
		root = mkdtempSync(path.join(tmpdir(), 'josh-review-tree-'))
	})

	afterEach(() => {
		rmSync(root, { recursive: true, force: true })
	})

	it('digests each file and sorts the entries', () => {
		writeFileSync(path.join(root, FILE_C), 'third')
		writeFileSync(path.join(root, FILE_A), 'first')

		const tree = review_tree.tree_of(root, [FILE_C, FILE_A])

		expect(Object.keys(tree)).toStrictEqual([FILE_A, FILE_C])
		expect(tree[FILE_A]).not.toBe(tree[FILE_C])
	})

	// A delete applied by a fix is part of the fix delta. Dropping the entry would read as
	// "unchanged" on the comparison, which is exactly backwards.
	it('records a path the tree no longer holds rather than dropping it', () => {
		expect(review_tree.tree_of(root, ['gone.ts'])['gone.ts']).toBe(review_tree.ABSENT_DIGEST)
	})

	// The root the digests are taken against comes from git, not from the working directory. Resolved
	// against `process.cwd()` — which is what `PROJECT_ROOT` is — a run from any subdirectory digests
	// every path as `absent`, and two such maps compare **equal**: the brief would report a tree
	// nobody verified as verified, and an empty fix delta as "the fixes changed nothing".
	it('digests a repository-relative path against the repository root', async () => {
		const tree = await review_tree.read_changed_tree(['package.json'])

		expect(tree['package.json']).not.toBe(review_tree.ABSENT_DIGEST)
	})
})

describe('file_map_stamp.changed_since', () => {
	it('is empty when the two readings agree', () => {
		const files = { [FILE_A]: 'x' }

		expect(file_map_stamp.changed_since(stamp_of(files), files)).toStrictEqual([])
	})

	it('reports added, removed and edited paths alike', () => {
		const changed = file_map_stamp.changed_since(stamp_of({ [FILE_A]: 'x', [FILE_B]: 'y' }), {
			[FILE_A]: EDITED,
			[FILE_C]: 'new',
		})

		expect(changed).toStrictEqual([FILE_A, FILE_B, FILE_C])
	})
})
