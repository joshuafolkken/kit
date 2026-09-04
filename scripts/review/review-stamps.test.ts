import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { file_map_stamp, type FileMapStampAccess } from '#scripts/josh/file-map-stamp'
import { test_unit_guard } from '#scripts/test-unit-guard'
import { verification_gate, type GateStepResult } from '#scripts/verification-gate'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { review_stamps } from './review-stamps'

// joshuafolkken/kit#1241: `josh gate` is the only thing that can honestly say the four checks passed,
// and `josh review:brief` is what has to tell the forked review agent so. The record between them is
// the whole mechanism, so what is tested here is that it round-trips, that the gate withholds it in
// every situation where it would be a lie, and that a temp-directory failure can never turn a green
// gate red.
//
// Nothing here asserts on a record the gate wrote for itself: `record_green_gate` reads the tree
// through git, and CI checks out a single branch at depth 1, so the read there answers differently
// from a developer's checkout. The write is exercised through the stamp directly, and the gate is
// exercised on the branches whose outcome is the same either way.

const FILE_A = 'a.ts'
const STAMP_FILE = 'stamp.json'
const DIGEST = 'digest'
const ABSENT_FILE = 'absent.json'
// A directory the suite never creates, so a write aimed through it throws.
const MISSING_DIRECTORY = 'missing'
// A directory the suite fills, so a removal aimed at it cannot be forgiven by `force`.
const OCCUPIED_DIRECTORY = 'occupied'
// A path no checkout holds, so the comparison against the real tree can only differ.
const NEVER_ON_DISK = 'never-on-disk.ts'

// The part of a stamp's file name after its prefix: the digest of the root it is keyed to.
function key_of(stamp_path: string, prefix: string): string {
	return path.basename(stamp_path).replace(prefix, '')
}

// Every suite below needs one throwaway directory to write records into, so the create-and-remove
// dance is written once. A getter rather than the path itself: `beforeEach` assigns a fresh one per
// case, and a value captured when the suite was defined would be the previous case's.
function use_temporary_directory(prefix: string): () => string {
	let directory = ''

	beforeEach(() => {
		directory = mkdtempSync(path.join(tmpdir(), prefix))
	})

	afterEach(() => {
		rmSync(directory, { recursive: true, force: true })
	})

	return () => directory
}

// The duration is carried by every result but read by none of the stamp logic, so a fixed value
// keeps these fixtures deterministic without pretending to have measured anything.
const UNUSED_ELAPSED_MS = 0

function step(label: string, output: string): GateStepResult {
	return { label, command: `josh ${label}`, output, exit_code: 0, elapsed_ms: UNUSED_ELAPSED_MS }
}

const PASSED: ReadonlyArray<GateStepResult> = [step('lint', 'ok')]
const SKIPPED: ReadonlyArray<GateStepResult> = [
	step('lint', 'ok'),
	step('test:unit', `josh test:unit: no tests ${test_unit_guard.SKIP_MARKER} vitest unit tests.`),
]

// The three records and their prefixes, so each assertion below covers every one of them rather than
// the two that existed first (joshuafolkken/kit#1242 added the in-flight marker).
const RECORDS: ReadonlyArray<readonly [string, FileMapStampAccess, string]> = [
	['gate', review_stamps.gate_stamp, review_stamps.GATE_PREFIX],
	['in-flight', review_stamps.in_flight_stamp, review_stamps.IN_FLIGHT_PREFIX],
	['round-1', review_stamps.round_one_stamp, review_stamps.ROUND_ONE_PREFIX],
]

describe('review_stamps — the three records are kept apart', () => {
	// One prefix per record. Sharing one would let the gate's result overwrite the round-1 snapshot
	// mid-run, and the fix delta would silently become "nothing changed" — or let the marker the gate
	// clears on its way out delete the snapshot round 2 is measured against.
	it('gives every record its own path', () => {
		const paths = new Set(RECORDS.map(([, access]) => access.stamp_path()))

		expect(paths.size).toBe(RECORDS.length)
	})

	// All three records describe one checkout, so their key — the digest of the root, the part after
	// the prefix — has to be the same digest. Asserting only that the paths sit in the temp directory
	// would hold just as well if one of them keyed on the package directory instead, which is the
	// regression that would let a run in one project answer for another.
	it('keys them all on the same checkout', () => {
		const keys = new Set(RECORDS.map(([, access, prefix]) => key_of(access.stamp_path(), prefix)))

		expect(keys.size).toBe(1)
	})

	it.each(RECORDS)('puts the %s record in the temp directory', (_label, access) => {
		expect(access.stamp_path()).toContain(tmpdir())
	})
})

describe('the record round trip', () => {
	const directory = use_temporary_directory('josh-gate-stamp-test-')
	const target = (): string => path.join(directory(), STAMP_FILE)

	it('reads back the tree it wrote, with a timestamp', () => {
		const files = { [FILE_A]: DIGEST }

		review_stamps.gate_stamp.write(files, target())

		const stamp = review_stamps.gate_stamp.read(target())

		expect(stamp?.files).toStrictEqual(files)
		expect(Date.parse(stamp?.taken_at ?? '')).not.toBeNaN()
	})

	// "There is no record" and "the record says nothing changed" are the two answers this whole
	// mechanism exists to keep apart.
	it('reads a missing record as undefined rather than as an empty tree', () => {
		const absent = path.join(directory(), ABSENT_FILE)

		expect(review_stamps.gate_stamp.read(absent)).toBeUndefined()
	})

	it('reads a payload that is not a file map as undefined', () => {
		expect(file_map_stamp.parse_stamp('{"taken_at":"now","files":{"a":1}}')).toBeUndefined()
	})

	// The in-flight marker means something only while it exists, so removing it is half the mechanism
	// (joshuafolkken/kit#1242). A record nobody removes goes on saying a gate is running after it ended.
	it('reads a removed record as undefined again', () => {
		review_stamps.in_flight_stamp.write({ [FILE_A]: DIGEST }, target())
		review_stamps.in_flight_stamp.remove(target())

		expect(review_stamps.in_flight_stamp.read(target())).toBeUndefined()
	})

	// Clearing runs on every exit path, including the ones where nothing was ever written — a gate whose
	// marker failed to write must not fail again on its way out.
	it('removes a record that was never there without throwing', () => {
		expect(() => {
			review_stamps.in_flight_stamp.remove(path.join(directory(), ABSENT_FILE))
		}).not.toThrow()
	})
})

describe('verification_gate.record_green_gate — withholds the record rather than lying', () => {
	const directory = use_temporary_directory('josh-gate-withhold-')
	const target = (): string => path.join(directory(), STAMP_FILE)

	// The gate keeps a skip visible on the console for exactly this reason: a run that executed zero
	// unit tests is not a run whose unit tests passed, and the brief would tell a review agent not to
	// re-run them.
	it('writes nothing when a step passed without running', async () => {
		await verification_gate.record_green_gate(SKIPPED, {}, target())

		expect(review_stamps.gate_stamp.read(target())).toBeUndefined()
	})

	// The `PostToolUse` formatter and an editor save both land while the checks are in flight. What
	// the checks read is the tree from before them, so a record of anything else is a claim about a
	// tree nobody verified.
	it('writes nothing when the tree moved while the checks ran', async () => {
		await verification_gate.record_green_gate(PASSED, { [NEVER_ON_DISK]: 'x' }, target())

		expect(review_stamps.gate_stamp.read(target())).toBeUndefined()
	})

	// joshuafolkken/kit#1328 added a fourth withholding — a check that passed *with warnings*, since
	// the reuse prints no check bodies and a warning recorded as an unqualified green would be printed
	// once and never again on that tree. It is asserted in `gate-skip.test.ts` rather than here: these
	// two cases pass their guard a `before` the real tree reading disagrees with, so the second guard
	// withholds the record whatever the first one decides, and a third case of that shape would look
	// like a regression test without being one.
})

// joshuafolkken/kit#1242: the marker is what lets `josh review:brief` say "a gate is running" instead
// of "no gate ever ran", now that the two are started together. It has to exist for exactly as long as
// the checks do — a marker that outlives its gate tells the next brief to wait for a result nobody is
// going to produce, and one that is never written costs a `Not verified`, which is the safe direction.
const MARKER_FILES = { [FILE_A]: DIGEST }

describe('verification_gate — the in-flight marker lasts exactly as long as the checks', () => {
	const directory = use_temporary_directory('josh-gate-inflight-')
	const target = (): string => path.join(directory(), STAMP_FILE)

	it('records the tree the checks are reading', () => {
		verification_gate.mark_gate_running(MARKER_FILES, target())

		expect(review_stamps.in_flight_stamp.read(target())?.files).toStrictEqual(MARKER_FILES)
	})

	it('is gone once the checks finish', () => {
		verification_gate.mark_gate_running(MARKER_FILES, target())
		verification_gate.clear_gate_running(target())

		expect(review_stamps.in_flight_stamp.read(target())).toBeUndefined()
	})
})

// Both halves swallow their failure for the same reason `record_green_gate` does: a temp-directory
// problem must never reach the gate's verdict, in either direction.
//
// **The two need different destinations, because `rmSync(force: true)` swallows a missing path by
// design.** Aimed at one, the clearing case would pass with `clear_gate_running`'s `try` deleted — a
// test asserting nothing. A directory that is not empty is something `force` does not forgive, so it
// is what proves the guard is load-bearing, and the case below proves it really does throw.
describe('verification_gate — marking and clearing never reach the verdict', () => {
	const directory = use_temporary_directory('josh-gate-marker-swallow-')

	function occupied_directory(): string {
		const occupied = path.join(directory(), OCCUPIED_DIRECTORY)

		mkdirSync(occupied, { recursive: true })
		writeFileSync(path.join(occupied, STAMP_FILE), '{}')

		return occupied
	}

	it('cannot remove a destination that is a non-empty directory', () => {
		expect(() => {
			review_stamps.in_flight_stamp.remove(occupied_directory())
		}).toThrow()
	})

	it('never throws while writing', () => {
		expect(() => {
			verification_gate.mark_gate_running(
				MARKER_FILES,
				path.join(directory(), MISSING_DIRECTORY, STAMP_FILE),
			)
		}).not.toThrow()
	})

	it('never throws while clearing', () => {
		expect(() => {
			verification_gate.clear_gate_running(occupied_directory())
		}).not.toThrow()
	})
})

// The marker is cleared on a red gate and a thrown check alike — a `finally`, not a success path. A
// gate that threw and left its marker behind would tell the next brief to wait for a result nobody is
// going to produce, which is the one state this record must never describe.
describe('verification_gate.with_gate_marker — clears on every exit', () => {
	const directory = use_temporary_directory('josh-gate-finally-')
	const target = (): string => path.join(directory(), STAMP_FILE)
	const files = { [FILE_A]: DIGEST }

	it('holds the marker while the work runs, and not after', async () => {
		await verification_gate.with_gate_marker(
			files,
			async () => {
				expect(review_stamps.in_flight_stamp.read(target())?.files).toStrictEqual(files)

				return 0
			},
			target(),
		)

		expect(review_stamps.in_flight_stamp.read(target())).toBeUndefined()
	})

	it('clears the marker when the work throws', async () => {
		const blew_up = 'checks blew up'

		await expect(
			verification_gate.with_gate_marker(
				files,
				async () => {
					throw new Error(blew_up)
				},
				target(),
			),
		).rejects.toThrow(blew_up)

		expect(review_stamps.in_flight_stamp.read(target())).toBeUndefined()
	})
})

// Two halves, because one of them alone would pass for the wrong reason: the first asserts there
// *is* something to catch — a destination under a directory that does not exist throws — and the
// second asserts the gate never rethrows it. Without the first, "resolves" would hold in a run where
// the write was skipped before it was ever attempted.
describe('verification_gate.record_green_gate — never reaches the gate verdict', () => {
	const directory = use_temporary_directory('josh-gate-swallow-')

	it('cannot write under a directory that does not exist', () => {
		expect(() => {
			review_stamps.gate_stamp.write(
				{ [FILE_A]: 'x' },
				path.join(directory(), MISSING_DIRECTORY, STAMP_FILE),
			)
		}).toThrow()
	})

	// A record is a convenience for the next command; nothing about it may reach the gate's own
	// verdict, whichever branch the run takes.
	it.each([
		['a tree that matches', {}],
		['a tree that does not', { [NEVER_ON_DISK]: 'x' }],
	])('resolves for %s', async (_label, before) => {
		const unwritable = path.join(directory(), MISSING_DIRECTORY, STAMP_FILE)

		await expect(
			verification_gate.record_green_gate(PASSED, before, unwritable),
		).resolves.toBeUndefined()
	})
})
