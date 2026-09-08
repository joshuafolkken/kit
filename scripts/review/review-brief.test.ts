import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { file_map_stamp, type FileMapStamp } from '#scripts/josh/file-map-stamp'
import { process_identity } from '#scripts/josh/process-identity'
import { process_identity_fixture } from '#scripts/josh/process-identity-fixture'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { review_brief } from './review-brief'
import { review_brief_cli } from './review-brief-cli'
import type { ReviewCheckout } from './review-checkout'
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

// The commit the change is measured against, resolved by the caller (joshuafolkken/kit#1527). One
// base throughout here, which is the ordinary run.
const BASE = 'fedcba9876543210fedcba9876543210fedcba98'
// A second commit, for the cases that assert what happens when the base moves under a record.
const OTHER_BASE = '89abcdef0123456789abcdef0123456789abcdef'

// The base travels with every record since joshuafolkken/kit#1537: a round-1 snapshot taken against a
// different commit is not comparable, and reads as "widen the round" rather than as a fix delta. The
// cases below are all one base, which is the ordinary run; the moved base has a suite of its own in
// `review-round2-target-scope.test.ts`, where real git moves it.
function stamp_of(files: Tree): FileMapStamp {
	return { taken_at: TAKEN_AT, files, base: BASE }
}

// A marker asserts a live process, so the fixture carries this run's whole identity — since
// joshuafolkken/kit#1245 that is the pid **and** the start time of the process behind it, assembled by
// the same helper a real record is written with. A fixture carrying only half of it is read as "not
// running", which is the stale case rather than the running one.
function started_stamp_of(files: Tree): FileMapStamp {
	return { taken_at: STARTED_AT, files, ...process_identity.own_fields() }
}

// A pid no live process holds, and a start time none can have — `process-identity-fixture.ts` for why
// each is the value it is.
const { DEAD_PID, FOREIGN_START, has_start_probe } = process_identity_fixture

function stale_stamp_of(files: Tree): FileMapStamp {
	return { taken_at: STARTED_AT, files, pid: DEAD_PID }
}

// This run's own pid, which is unmistakably alive, paired with a start time that is not its own. That
// pair is what a marker looks like from the reader's side once the operating system has reissued the
// pid its gate held (joshuafolkken/kit#1245).
function recycled_stamp_of(files: Tree): FileMapStamp {
	return { taken_at: STARTED_AT, files, pid: process.pid, process_start: FOREIGN_START }
}

// A path no fixture file name is a substring of, so `not.toContain(FILE_B)` still means what it says
// once the round-2 target prints its paths under this root (joshuafolkken/kit#1522).
const CHECKOUT: ReviewCheckout = {
	root: '/lanes/1522',
	branch: '1522-lane',
	head: '0123456789abcdef0123456789abcdef01234567',
}
const NONCE = 'deadbeefcafef00d'

function compose(input: {
	round: number
	tree: Record<string, string>
	gate?: FileMapStamp
	in_flight?: FileMapStamp
	round_one?: FileMapStamp
	checkout?: ReviewCheckout
}): string {
	return review_brief.compose({
		level: LEVEL,
		round: input.round,
		tree: input.tree,
		stamps: { gate: input.gate, in_flight: input.in_flight, round_one: input.round_one },
		checkout: input.checkout ?? CHECKOUT,
		nonce: NONCE,
		base: BASE,
	})
}

function gate_line(
	input: { gate?: FileMapStamp; in_flight?: FileMapStamp; base?: string },
	tree: Tree,
): string {
	return review_brief.gate_line(
		{ gate: input.gate, in_flight: input.in_flight },
		tree,
		input.base ?? BASE,
	)
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

// joshuafolkken/kit#1537: matching digests are not enough. A merge of the default branch that touches
// nothing the branch touches leaves every digest identical while the tree gains code the gate never
// read, so the commit the gate measured against is compared too.
describe('review_brief.gate_line — the base the gate was green against', () => {
	const tree = { [FILE_A]: 'x', [FILE_B]: 'y' }

	// A merge of the default branch that touches nothing the branch touches
	// leaves every digest identical, so the digests alone would still say "this exact tree" about a
	// tree that gained code the gate never read. The gate records the commit it measured against; this
	// is the same refusal `gate-skip.ts` already makes of the same record.
	it('refuses to claim green when the gate measured a different change base', () => {
		const line = gate_line({ gate: stamp_of(tree), base: OTHER_BASE }, tree)

		expect(line).toContain(NOT_VERIFIED)
		expect(line).not.toContain(VERIFIED)
	})

	// A record written before the field existed cannot be shown to describe this base, and the safe
	// answer for an unprovable green is the same one a stale record gets.
	it('refuses to claim green when the gate record carries no base', () => {
		const line = gate_line({ gate: { taken_at: TAKEN_AT, files: tree } }, tree)

		expect(line).toContain(NOT_VERIFIED)
		expect(line).not.toContain(VERIFIED)
	})

	// The in-flight marker carries no base and claims no result, so requiring one would delete the
	// state joshuafolkken/kit#1242 added rather than guard it.
	it('still reports a running gate when the change base moved', () => {
		expect(gate_line({ in_flight: started_stamp_of(tree), base: OTHER_BASE }, tree)).toContain(
			RUNNING,
		)
	})
})

// joshuafolkken/kit#1242: the gate and the review are started together, so at the moment the brief is
// composed the checks are usually still running. Without a third state that is indistinguishable from
// "no gate was ever run", and the review agent re-runs the unit suite the gate is running beside it —
// the exact cost joshuafolkken/kit#1241 had just removed.
//
// **The block is skipped where the platform cannot report a process start time.** Since
// joshuafolkken/kit#1245 a marker is believed only when its writer can be identified, and on such a
// platform `own_fields` records no start time, so the brief correctly never reaches this state —
// asserting it there would be asserting something the code does not promise.
describe.skipIf(!has_start_probe)(
	'review_brief.gate_line — a running gate is its own state',
	() => {
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
	},
)

// Every case here is a marker the brief must *not* believe, and none of them depends on the platform
// being able to report a start time — a dead pid and a missing pid are decided before the probe is
// reached, and the reissued one is decided by a start time the fixture supplies.
describe('review_brief.gate_line — the marker must name the process that wrote it', () => {
	const tree = { [FILE_A]: 'x', [FILE_B]: 'y' }

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

	// **The hole the pid alone left open** (joshuafolkken/kit#1245). A gate killed with Ctrl-C leaves
	// its marker behind; the operating system then hands that pid to something unrelated, the liveness
	// probe passes, and the digests still match because nobody edited the tree — so this line printed
	// "a gate is running on this tree" about a gate that had ended. The recorded start time is what
	// separates the reissued process from the one that wrote the record.
	it('falls back to not-verified when the marker names a pid that was reissued', () => {
		const line = gate_line({ in_flight: recycled_stamp_of(tree) }, tree)

		expect(line).toContain(NOT_VERIFIED)
		expect(line).not.toContain(RUNNING)
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

		expect(brief).toContain(review_brief.no_snapshot_line(CHECKOUT.root, BASE))
		expect(brief).toContain(review_brief.whole_change_target(CHECKOUT.root, BASE))
	})

	it('says so when nothing changed since round 1', () => {
		expect(compose({ round: 2, tree: before, round_one: stamp_of(before) })).toContain(
			review_brief.EMPTY_DELTA_LINE,
		)
	})

	it('reviews the whole change on round 1', () => {
		expect(compose({ round: 1, tree: before })).toContain(
			review_brief.whole_change_target(CHECKOUT.root, BASE),
		)
	})
})

// joshuafolkken/kit#1527. This line is a command the forked agent runs, and in a lane a two-dot
// `git diff main` lists whatever another lane merged since the lane was cut — so the base is the
// merge base, and it is embedded as a value rather than as a `$(…)` a failing subshell would expand
// to nothing, leaving a bare `git diff` that lists only the unstaged working tree.
describe('review_brief — the target names the base it measures against', () => {
	it('embeds the resolved base rather than the default-branch ref', () => {
		const target = review_brief.whole_change_target(CHECKOUT.root, BASE)

		expect(target).toContain(`git -C ${CHECKOUT.root} diff ${BASE}`)
		expect(target).not.toContain('main')
	})

	it('never prints a command substitution that could expand to nothing', () => {
		expect(review_brief.whole_change_target(CHECKOUT.root, BASE)).not.toContain('$(')
	})
})

// joshuafolkken/kit#1522. `/code-review` is forked by the harness and inherits the session's working
// directory, so during a lane run it starts in a tree holding the previous child's already-merged
// code. Reading that, it finds nothing wrong and says so — and the run cannot tell that silence apart
// from a clean review. The checkout is therefore named in the brief itself, generated from git rather
// than typed in by whoever wrote the hand-off.
describe('review_brief — the brief names the checkout it describes', () => {
	const tree = { [FILE_A]: 'x' }

	it('prints the root, the branch and the head', () => {
		const brief = compose({ round: 1, tree })

		expect(brief).toContain(CHECKOUT.root)
		expect(brief).toContain(CHECKOUT.branch)
		expect(brief).toContain(CHECKOUT.head)
	})

	// Copied verbatim, a literal `<path>` fails and sends the agent back to the tree it inherited —
	// which is the wrong one, and the whole failure this block exists to prevent.
	it('interpolates the root into the command it tells the agent to run', () => {
		const brief = compose({ round: 1, tree })

		expect(brief).toContain(review_brief.checkout_warning(CHECKOUT.root))
		expect(brief).not.toContain('<path>')
	})

	// The nonce is what the run checks afterwards, so a brief that printed no attestation command
	// would leave the mistargeted review indistinguishable from a clean one — the whole defect.
	it('carries the attestation command with the nonce of this run', () => {
		expect(compose({ round: 1, tree })).toContain(review_brief.attest_line(NONCE))
	})

	it('keeps the level on the first line', () => {
		expect(compose({ round: 1, tree }).split('\n', 1)[0]).toBe(LEVEL)
	})

	// git prints repository-root-relative paths, and a forked agent sitting in another checkout
	// resolves them against that one — where the same relative path names a different file, or none.
	it('names the fix delta under the root it briefed', () => {
		const before = { [FILE_A]: 'x', [FILE_B]: 'y' }
		const after = { ...before, [FILE_A]: EDITED }

		expect(compose({ round: 2, tree: after, round_one: stamp_of(before) })).toContain(
			`${CHECKOUT.root}/${FILE_A}`,
		)
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
