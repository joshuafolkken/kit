import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { file_map_stamp } from '#scripts/josh/file-map-stamp'
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
// A path no checkout holds, so the comparison against the real tree can only differ.
const NEVER_ON_DISK = 'never-on-disk.ts'

// The part of a stamp's file name after its prefix: the digest of the root it is keyed to.
function key_of(stamp_path: string, prefix: string): string {
	return path.basename(stamp_path).replace(prefix, '')
}

function step(label: string, output: string): GateStepResult {
	return { label, command: `josh ${label}`, output, exit_code: 0 }
}

const PASSED: ReadonlyArray<GateStepResult> = [step('lint', 'ok')]
const SKIPPED: ReadonlyArray<GateStepResult> = [
	step('lint', 'ok'),
	step('test:unit', `josh test:unit: no tests ${test_unit_guard.SKIP_MARKER} vitest unit tests.`),
]

describe('review_stamps — the two records are kept apart', () => {
	// One prefix per record. Sharing one would let the gate's result overwrite the round-1 snapshot
	// mid-run, and the fix delta would silently become "nothing changed".
	it('gives the gate and the round-1 snapshot different paths', () => {
		expect(review_stamps.gate_stamp.stamp_path()).not.toBe(
			review_stamps.round_one_stamp.stamp_path(),
		)
	})

	// Both records describe one checkout, so their key — the digest of the root, the part after the
	// prefix — has to be the same digest. Asserting only that the paths sit in the temp directory
	// would hold just as well if one of them keyed on the package directory instead, which is the
	// regression that would let a run in one project answer for another.
	it('keys both on the same checkout', () => {
		expect(key_of(review_stamps.gate_stamp.stamp_path(), review_stamps.GATE_PREFIX)).toBe(
			key_of(review_stamps.round_one_stamp.stamp_path(), review_stamps.ROUND_ONE_PREFIX),
		)
	})

	it('puts both in the temp directory', () => {
		for (const access of [review_stamps.gate_stamp, review_stamps.round_one_stamp]) {
			expect(access.stamp_path()).toContain(tmpdir())
		}
	})
})

describe('the record round trip', () => {
	let directory = ''
	let target = ''

	beforeEach(() => {
		directory = mkdtempSync(path.join(tmpdir(), 'josh-gate-stamp-test-'))
		target = path.join(directory, STAMP_FILE)
	})

	afterEach(() => {
		rmSync(directory, { recursive: true, force: true })
	})

	it('reads back the tree it wrote, with a timestamp', () => {
		const files = { [FILE_A]: 'digest' }

		review_stamps.gate_stamp.write(files, target)

		const stamp = review_stamps.gate_stamp.read(target)

		expect(stamp?.files).toStrictEqual(files)
		expect(Date.parse(stamp?.taken_at ?? '')).not.toBeNaN()
	})

	// "There is no record" and "the record says nothing changed" are the two answers this whole
	// mechanism exists to keep apart.
	it('reads a missing record as undefined rather than as an empty tree', () => {
		expect(review_stamps.gate_stamp.read(path.join(directory, 'absent.json'))).toBeUndefined()
	})

	it('reads a payload that is not a file map as undefined', () => {
		expect(file_map_stamp.parse_stamp('{"taken_at":"now","files":{"a":1}}')).toBeUndefined()
	})
})

describe('verification_gate.record_green_gate — withholds the record rather than lying', () => {
	let directory = ''
	let target = ''

	beforeEach(() => {
		directory = mkdtempSync(path.join(tmpdir(), 'josh-gate-withhold-'))
		target = path.join(directory, STAMP_FILE)
	})

	afterEach(() => {
		rmSync(directory, { recursive: true, force: true })
	})

	// The gate keeps a skip visible on the console for exactly this reason: a run that executed zero
	// unit tests is not a run whose unit tests passed, and the brief would tell a review agent not to
	// re-run them.
	it('writes nothing when a step passed without running', async () => {
		await verification_gate.record_green_gate(SKIPPED, {}, target)

		expect(review_stamps.gate_stamp.read(target)).toBeUndefined()
	})

	// The `PostToolUse` formatter and an editor save both land while the checks are in flight. What
	// the checks read is the tree from before them, so a record of anything else is a claim about a
	// tree nobody verified.
	it('writes nothing when the tree moved while the checks ran', async () => {
		await verification_gate.record_green_gate(PASSED, { [NEVER_ON_DISK]: 'x' }, target)

		expect(review_stamps.gate_stamp.read(target)).toBeUndefined()
	})
})

// Two halves, because one of them alone would pass for the wrong reason: the first asserts there
// *is* something to catch — a destination under a directory that does not exist throws — and the
// second asserts the gate never rethrows it. Without the first, "resolves" would hold in a run where
// the write was skipped before it was ever attempted.
describe('verification_gate.record_green_gate — never reaches the gate verdict', () => {
	let directory = ''

	beforeEach(() => {
		directory = mkdtempSync(path.join(tmpdir(), 'josh-gate-swallow-'))
	})

	afterEach(() => {
		rmSync(directory, { recursive: true, force: true })
	})

	it('cannot write under a directory that does not exist', () => {
		expect(() => {
			review_stamps.gate_stamp.write({ [FILE_A]: 'x' }, path.join(directory, 'missing', STAMP_FILE))
		}).toThrow()
	})

	// A record is a convenience for the next command; nothing about it may reach the gate's own
	// verdict, whichever branch the run takes.
	it.each([
		['a tree that matches', {}],
		['a tree that does not', { [NEVER_ON_DISK]: 'x' }],
	])('resolves for %s', async (_label, before) => {
		await expect(
			verification_gate.record_green_gate(
				PASSED,
				before,
				path.join(directory, 'missing', STAMP_FILE),
			),
		).resolves.toBeUndefined()
	})
})
