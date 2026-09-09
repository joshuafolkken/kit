import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hook_decision } from './josh/hook-decision'
import { review_stamps } from './review/review-stamps'
import { scoped_green, type ScopedSources } from './scoped-green'

// joshuafolkken/kit#1511: `fullrun #1503` started `josh gate` and review round 1 on a tree neither
// `lint:related` nor `test:related` had ever been green on, and paid 282 seconds — 31% of the run —
// picking the consequences up one finding at a time afterwards.
//
// **The records are written to an explicit temp path, never the real one.** The scoped records are
// shared per checkout exactly as the round-1 snapshot is, so a suite writing to the real path would
// vouch for the surrounding run's own tree — the trap joshuafolkken/kit#1437 closed for the gate
// records and joshuafolkken/kit#1441 for the round-1 one.

const BASE = 'f4d79002'
const MOVED_BASE = 'a22b3479'
const CHANGED_FILE = 'scripts/scoped-green.ts'
const DIGEST = 'digest-before'
const EDITED_DIGEST = 'digest-after'
const FAILED_EXIT_CODE = 1
const SUCCESS_EXIT_CODE = 0
const NO_ARGUMENTS: ReadonlyArray<string> = []

function tree_of(digest: string = DIGEST): Record<string, string> {
	return { [CHANGED_FILE]: digest }
}

// Named from the pid rather than assigned in a hook, so nothing here writes to a top-level binding
// from inside a function — and two suites running at once still never share a record.
const DIRECTORY = path.join(tmpdir(), `josh-scoped-green-suite-${String(process.pid)}`)

function sources(): ScopedSources {
	return { lint: path.join(DIRECTORY, 'lint.json'), test: path.join(DIRECTORY, 'test.json') }
}

function plant(target: string | undefined, digest: string, base: string): void {
	review_stamps.lint_related_stamp.write(tree_of(digest), target, base)
}

function plant_both(digest: string = DIGEST, base: string = BASE): ScopedSources {
	const planted = sources()

	plant(planted.lint, digest, base)
	plant(planted.test, digest, base)

	return planted
}

beforeEach(() => {
	mkdirSync(DIRECTORY, { recursive: true })
})

afterEach(() => {
	vi.unstubAllEnvs()
	rmSync(DIRECTORY, { recursive: true, force: true })
})

describe('missing_checks', () => {
	it('names both scoped checks when neither has a record for this tree', () => {
		expect(scoped_green.missing_checks(tree_of(), BASE, sources())).toStrictEqual([
			scoped_green.LINT_COMMAND,
			scoped_green.TEST_COMMAND,
		])
	})

	it('names nothing when both records describe this tree', () => {
		expect(scoped_green.missing_checks(tree_of(), BASE, plant_both())).toStrictEqual([])
	})

	it('names only the check whose record is missing', () => {
		const planted = sources()

		plant(planted.lint, DIGEST, BASE)

		expect(scoped_green.missing_checks(tree_of(), BASE, planted)).toStrictEqual([
			scoped_green.TEST_COMMAND,
		])
	})

	it('invalidates both records when a file changed since they were written', () => {
		const planted = plant_both()

		expect(scoped_green.missing_checks(tree_of(EDITED_DIGEST), BASE, planted)).toStrictEqual([
			scoped_green.LINT_COMMAND,
			scoped_green.TEST_COMMAND,
		])
	})

	it('invalidates both records when the change base moved under them', () => {
		const planted = plant_both(DIGEST, MOVED_BASE)

		expect(scoped_green.missing_checks(tree_of(), BASE, planted)).toStrictEqual([
			scoped_green.LINT_COMMAND,
			scoped_green.TEST_COMMAND,
		])
	})
})

describe('missing_checks — the three states that must never refuse', () => {
	it('names nothing when the tree has no changed file', () => {
		expect(scoped_green.missing_checks({}, BASE, sources())).toStrictEqual([])
	})

	it('names nothing when the change base could not be resolved', () => {
		expect(scoped_green.missing_checks(tree_of(), undefined, sources())).toStrictEqual([])
	})

	it('names nothing when the switch is turned off', () => {
		vi.stubEnv(scoped_green.SWITCH_ENV_KEY, hook_decision.DISABLED_VALUES[0])

		expect(scoped_green.missing_checks(tree_of(), BASE, sources())).toStrictEqual([])
	})
})

describe('refusal_for', () => {
	it('answers undefined once both records describe this tree', () => {
		expect(scoped_green.refusal_for(tree_of(), BASE, plant_both())).toBeUndefined()
	})

	it('carries the headline and the command that closes it', () => {
		const refusal = scoped_green.refusal_for(tree_of(), BASE, sources())

		expect(refusal).toContain(scoped_green.REFUSAL_HEADLINE)
		expect(refusal).toContain(`${scoped_green.LINT_COMMAND} && ${scoped_green.TEST_COMMAND}`)
	})
})

describe('is_recordable_scope', () => {
	it('accepts a bare invocation, which is the one that answered for the whole changed set', () => {
		expect(scoped_green.is_recordable_scope(NO_ARGUMENTS)).toBe(true)
	})

	it('refuses a run narrowed to explicit paths', () => {
		expect(scoped_green.is_recordable_scope([CHANGED_FILE])).toBe(false)
	})

	it('refuses a run carrying a flag, because a flag can narrow as hard as a path', () => {
		expect(scoped_green.is_recordable_scope(['--shard=1/4'])).toBe(false)
		expect(scoped_green.is_recordable_scope(['--reporter=dot'])).toBe(false)
	})
})

describe('read_before', () => {
	it('reads nothing for a narrowed run, so no record can follow it', async () => {
		await expect(scoped_green.read_before([CHANGED_FILE])).resolves.toBeUndefined()
	})
})

describe('is_unmoved', () => {
	it('accepts a tree whose digests and change base both held', () => {
		const before = { files: tree_of(), base: BASE }

		expect(scoped_green.is_unmoved(before, { files: tree_of(), base: BASE })).toBe(true)
	})

	it('refuses a tree a file changed in while the checks were in flight', () => {
		const before = { files: tree_of(), base: BASE }

		expect(scoped_green.is_unmoved(before, { files: tree_of(EDITED_DIGEST), base: BASE })).toBe(
			false,
		)
	})

	it('refuses a tree whose change base moved while the checks were in flight', () => {
		const before = { files: tree_of(), base: BASE }

		expect(scoped_green.is_unmoved(before, { files: tree_of(), base: MOVED_BASE })).toBe(false)
	})
})

describe('record_if_green', () => {
	it('writes nothing when the run failed', async () => {
		const target = path.join(DIRECTORY, 'red.json')

		await scoped_green.record_if_green(review_stamps.lint_related_stamp, {
			before: { files: tree_of(), base: BASE },
			exit_code: FAILED_EXIT_CODE,
		})

		expect(review_stamps.lint_related_stamp.read(target)).toBeUndefined()
	})

	it('writes nothing when the caller judged the run inconclusive', async () => {
		const target = path.join(DIRECTORY, 'inconclusive.json')

		await scoped_green.record_if_green(review_stamps.lint_related_stamp, {
			before: undefined,
			exit_code: SUCCESS_EXIT_CODE,
		})

		expect(review_stamps.lint_related_stamp.read(target)).toBeUndefined()
	})
})

describe('record_green', () => {
	it('writes a record a later read matches this tree against', () => {
		const target = path.join(DIRECTORY, 'written.json')

		scoped_green.record_green(
			review_stamps.lint_related_stamp,
			{
				files: tree_of(),
				base: BASE,
			},
			target,
		)

		expect(review_stamps.lint_related_stamp.read(target)?.base).toBe(BASE)
	})

	it('withholds a record when the change base could not be resolved', () => {
		const target = path.join(DIRECTORY, 'no-base.json')

		scoped_green.record_green(
			review_stamps.lint_related_stamp,
			{
				files: tree_of(),
				base: undefined,
			},
			target,
		)

		expect(review_stamps.lint_related_stamp.read(target)).toBeUndefined()
	})

	it('withholds a record when the tree has no changed file', () => {
		const target = path.join(DIRECTORY, 'empty.json')

		scoped_green.record_green(review_stamps.lint_related_stamp, { files: {}, base: BASE }, target)

		expect(review_stamps.lint_related_stamp.read(target)).toBeUndefined()
	})
})
