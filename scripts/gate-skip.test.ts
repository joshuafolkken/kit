import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { gate_skip } from './gate-skip'
import { gate_test_fixture } from './gate-test-fixture'
import { review_stamps } from './review/review-stamps'

// joshuafolkken/kit#1328: the gate wrote down which tree it was green on and never read it back, so
// a second run over an unedited tree spent 47–50 seconds reaching a conclusion already on disk.
//
// What the assertions here are really about is that a file map is a **diff**, so everything it says
// stays true while the branch it is measured against moves underneath it. Two shapes of that, and
// both would have the gate report code no check ever read as green: an empty map, which is what
// `git switch main && git pull` leaves and which compares equal to any other empty map; and a map
// that survives a rebase onto an advanced default branch byte-for-byte while the rest of the working
// tree is replaced.

vi.mock('execa', () => ({ execa: vi.fn() }))

vi.mock('./type-check-step', () => ({
	type_check_step: {
		resolve_type_check_args: async (): Promise<ReadonlyArray<string>> => ['josh', 'check'],
	},
}))

// The two readings the gate takes before its checks, both mocked so a test can move one without the
// other — which is the whole point: the interesting failures are the ones where the map holds still.
const repository = vi.hoisted(() => ({
	tree: {},
	base: '',
}))

vi.mock('./review/review-tree', () => ({
	review_tree: {
		read_changed_tree: async (): Promise<Record<string, string>> => repository.tree,
	},
}))

vi.mock('./git/git-command', () => ({
	git_command: {
		default_branch_commit: async (): Promise<string> => repository.base,
	},
}))

const { verification_gate } = await import('./verification-gate')
const execa_module = await import('execa')
const mocked_execa = vi.mocked(execa_module.execa)

const { as_execa_implementation, capture_stdout, fake_result, FORWARDED_FLAG } = gate_test_fixture

const PASS = 0
const CHECK_COUNT = 4
const NOTHING_RAN = 0
const CHANGED_FILE = 'scripts/gate-skip.ts'
const CHANGED_TREE: Record<string, string> = { [CHANGED_FILE]: 'digest-one' }
const MOVED_TREE: Record<string, string> = { [CHANGED_FILE]: 'digest-two' }
const EMPTY_TREE: Record<string, string> = {}
const BASE = 'a1b2c3d4'
const ADVANCED_BASE = 'e5f6a7b8'

// Paths of this suite's own. `josh gate` and `josh review:brief` share both records by design, and
// this suite runs *inside* `pnpm josh gate` — a test writing to the shared marker would clear the
// live gate's own, which is the record telling the review beside it not to re-run the unit suite.
const SUITE_KEY = String(process.pid)
const STAMP_PATH = path.join(tmpdir(), `josh-gate-skip-stamp-${SUITE_KEY}.json`)
const MARKER_PATH = path.join(tmpdir(), `josh-gate-skip-marker-${SUITE_KEY}.json`)

// Which check ran is `verification-gate.test.ts`'s subject; here every one passes and what is counted
// is how many were started at all. The body matters in one case only — a check that passed with
// something to say must leave no record behind.
function pass_every_check(body = ''): void {
	mocked_execa.mockImplementation(as_execa_implementation(async () => fake_result(PASS, body)))
}

async function run_gate(is_forced = false, body = ''): Promise<[number, string]> {
	pass_every_check(body)
	const stdout = capture_stdout()

	try {
		const code = await verification_gate.run_verification_gate({
			is_forced,
			stamp_path: STAMP_PATH,
			marker_path: MARKER_PATH,
		})

		return [code, stdout.text()]
	} finally {
		stdout.restore()
	}
}

function record_green(files: Record<string, string>, base?: string): void {
	review_stamps.gate_stamp.write(files, STAMP_PATH, base)
}

function check_count(): number {
	return mocked_execa.mock.calls.length
}

beforeEach(() => {
	vi.clearAllMocks()
	rmSync(STAMP_PATH, { force: true })
	rmSync(MARKER_PATH, { force: true })
	repository.tree = CHANGED_TREE
	repository.base = BASE
})

afterEach(() => {
	rmSync(STAMP_PATH, { force: true })
	rmSync(MARKER_PATH, { force: true })
})

describe('reusable_green_gate', () => {
	it('reuses the record when neither the files nor the base moved', () => {
		record_green(CHANGED_TREE, BASE)

		expect(gate_skip.reusable_green_gate(CHANGED_TREE, BASE, STAMP_PATH)?.taken_at).toBeTypeOf(
			'string',
		)
	})

	it('refuses the record when a file it covers has moved', () => {
		record_green(CHANGED_TREE, BASE)

		expect(gate_skip.reusable_green_gate(MOVED_TREE, BASE, STAMP_PATH)).toBeUndefined()
	})

	// A rebase onto an advanced default branch: the same files still differ by the same digests, over
	// a working tree whose every other file has been replaced.
	it('refuses the record when only the base moved', () => {
		record_green(CHANGED_TREE, BASE)

		expect(gate_skip.reusable_green_gate(CHANGED_TREE, ADVANCED_BASE, STAMP_PATH)).toBeUndefined()
	})

	// `git switch main && git pull` empties the map, and two empty maps agree.
	it('refuses an empty map even when the record is empty too', () => {
		record_green(EMPTY_TREE, BASE)

		expect(gate_skip.reusable_green_gate(EMPTY_TREE, BASE, STAMP_PATH)).toBeUndefined()
	})

	it('refuses a record written before the base was pinned', () => {
		record_green(CHANGED_TREE)

		expect(gate_skip.reusable_green_gate(CHANGED_TREE, BASE, STAMP_PATH)).toBeUndefined()
	})

	// No base means no reuse — never reuse without one.
	it('refuses when the base could not be read at all', () => {
		record_green(CHANGED_TREE, BASE)

		expect(gate_skip.reusable_green_gate(CHANGED_TREE, undefined, STAMP_PATH)).toBeUndefined()
	})

	it('refuses when no record was ever written', () => {
		expect(gate_skip.reusable_green_gate(CHANGED_TREE, BASE, STAMP_PATH)).toBeUndefined()
	})
})

describe('run_verification_gate — a tree that is already green', () => {
	beforeEach(() => {
		record_green(CHANGED_TREE, BASE)
	})

	it('starts none of the four checks', async () => {
		const [code] = await run_gate()

		expect(code).toBe(0)
		expect(check_count()).toBe(NOTHING_RAN)
	})

	// The output has to read as the result it is reusing. "skipped" alone reads as `Not verified`,
	// which is what the run would then be committing on.
	it('says the tree is green rather than saying nothing ran', async () => {
		const [, text] = await run_gate()

		expect(text).toContain('this tree is already green')
		expect(text).toContain(gate_skip.FORCE_FLAG)
	})

	// The plan describes a fan-out; a skip started no process for it to describe.
	it('announces no plan it did not carry out', async () => {
		const [, text] = await run_gate()

		expect(text).not.toContain('plan:')
	})

	it('runs all four checks when the caller forces them', async () => {
		const [code] = await run_gate(true)

		expect(code).toBe(0)
		expect(check_count()).toBe(CHECK_COUNT)
	})
})

describe('run_verification_gate — a tree the record cannot speak for', () => {
	// A red gate writes no record at all, which is why the re-verification after a fix reaches this
	// same branch: joshuafolkken/kit#1261's join before the commit must never be the one that skips.
	it('runs all four checks when no record exists', async () => {
		const [, text] = await run_gate()

		expect(check_count()).toBe(CHECK_COUNT)
		expect(text).toContain('verification gate passed')
	})

	it('runs all four checks when a file has moved since the record', async () => {
		record_green(MOVED_TREE, BASE)

		await run_gate()

		expect(check_count()).toBe(CHECK_COUNT)
	})

	it('runs all four checks when the default branch moved under the same map', async () => {
		record_green(CHANGED_TREE, ADVANCED_BASE)

		await run_gate()

		expect(check_count()).toBe(CHECK_COUNT)
	})

	// Straight after `git switch main && git pull`, both sides are empty and would compare equal.
	it('runs all four checks when the pull left the changed map empty', async () => {
		repository.tree = EMPTY_TREE
		record_green(EMPTY_TREE, BASE)

		await run_gate()

		expect(check_count()).toBe(CHECK_COUNT)
	})
})

// The two halves of the feature meeting: what a green run writes has to be what the next run can
// reuse. Asserted as one round trip, because a record written without a base reads as unusable and
// each half alone would pass while the pair did nothing.
describe('run_verification_gate — the record a green run leaves behind', () => {
	it('pins the base the checks were green against', async () => {
		await run_gate()

		expect(review_stamps.gate_stamp.read(STAMP_PATH)?.base).toBe(BASE)
	})

	it('is reused by the very next run over the same tree', async () => {
		await run_gate()
		vi.clearAllMocks()

		await run_gate()

		expect(check_count()).toBe(NOTHING_RAN)
	})

	// The skip prints no check bodies, so a record taken from a run that had something to say would
	// make those lines disappear from every later run over the same tree. Asserted here rather than
	// beside `record_green_gate`'s other withholdings, because only here is the tree reading mocked:
	// with the real one the maps disagree and the record is withheld for that reason instead, so the
	// guard under test could be deleted and the assertion would still hold.
	it('is withheld from a run whose checks had something to say', async () => {
		await run_gate(false, 'src/a.ts:1:1  warning  Unexpected console statement')

		expect(review_stamps.gate_stamp.read(STAMP_PATH)).toBeUndefined()
	})
})

describe('run_gate_command — the force flag', () => {
	it('accepts the flag the gate consumes itself', async () => {
		pass_every_check()
		const stdout = capture_stdout()

		try {
			const code = await verification_gate.run_gate_command([gate_skip.FORCE_FLAG], {
				stamp_path: STAMP_PATH,
				marker_path: MARKER_PATH,
			})

			expect(code).toBe(0)
		} finally {
			stdout.restore()
		}
	})

	// A refusal that named only `--verbose` would send a reader to drop the flag they need.
	it('names both accepted flags when it refuses an argument', async () => {
		const stderr: Array<string> = []
		const spy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
			stderr.push(String(chunk))

			return true
		})

		try {
			await verification_gate.run_gate_command([FORWARDED_FLAG], {
				stamp_path: STAMP_PATH,
				marker_path: MARKER_PATH,
			})

			expect(stderr.join('')).toContain(verification_gate.ACCEPTED_FLAGS.join(' '))
		} finally {
			spy.mockRestore()
		}
	})
})
