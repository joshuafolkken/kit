import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { read_repo_file } from './ai-document-fixture'
import { gate_bump_order } from './gate-bump-order'
import { gate_skip } from './gate-skip'
import { gate_test_fixture } from './gate-test-fixture'
import { review_stamps } from './review/review-stamps'

// joshuafolkken/kit#1437: `josh bump` always rewrites `package.json`, so a gate run before it is
// certain to run again after it. The measured run (`fullrun 1428`, PR #1435) went `gate` → `bump` →
// `gate` and threw the first 19 seconds away.
//
// What the assertions here are really about is the **absence of false positives**. A refusal that
// fired on a legitimate gate would train a run to reach for `--force` by reflex, and there are exactly
// two legitimate gates around a bump: the one started beside `/code-review` before any bump exists,
// and the re-run after it. Both have a case below.

vi.mock('execa', () => ({ execa: vi.fn() }))

vi.mock('./type-check-step', () => ({
	type_check_step: {
		resolve_type_check_args: async (): Promise<ReadonlyArray<string>> => ['josh', 'check'],
	},
}))

// The two readings the gate takes before its checks. Mocked so a test can move the tree without
// moving the base, which is the pair the refusal is decided from.
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

const { as_execa_implementation, capture_stdout, fake_result } = gate_test_fixture

const PASS = 0
const CHECK_COUNT = 4
const NOTHING_RAN = 0
const REFUSED_EXIT_CODE = 1

const WORK_FILE = 'scripts/gate-bump-order.ts'
const PACKAGE_JSON = 'package.json'
const BASE = 'a1b2c3d4'
const ADVANCED_BASE = 'e5f6a7b8'
const BUMP_COMMAND = 'pnpm josh bump minor'

const BEFORE_FIX: Record<string, string> = { [WORK_FILE]: 'digest-one' }
const AFTER_FIX: Record<string, string> = { [WORK_FILE]: 'digest-two' }
const VERSION_DIGEST = 'digest-version'
const AFTER_BUMP: Record<string, string> = { ...AFTER_FIX, [PACKAGE_JSON]: VERSION_DIGEST }
const NESTED_MANIFEST = `packages/app/${PACKAGE_JSON}`
const OTHER_FILE = 'scripts/somewhere-else.ts'
const OTHER_WORK: Record<string, string> = { [OTHER_FILE]: 'digest-three' }

// This suite's own records. `josh gate` and `josh review:brief` share the real ones by design, and this
// suite runs *inside* `pnpm josh gate` — planting into the shared path would rewrite the live gate's.
const RECORDS = gate_test_fixture.suite_records('bump-order')
const { clear: clear_records, marker_path: MARKER_PATH, stamp_path: STAMP_PATH } = RECORDS

function record_green(files: Record<string, string>, base?: string): void {
	review_stamps.gate_stamp.write(files, STAMP_PATH, base)
}

// `base` is passed rather than defaulted, so the "no base at all" case cannot be written as an
// explicit `undefined` that a default parameter would quietly replace with a real commit.
function owed(tree: Record<string, string>, base: string | undefined): boolean {
	return gate_bump_order.owed_bump_gate(tree, base, STAMP_PATH) !== undefined
}

async function run_gate(is_forced = false): Promise<[number, string]> {
	mocked_execa.mockImplementation(as_execa_implementation(async () => fake_result(PASS, '')))
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

function check_count(): number {
	return mocked_execa.mock.calls.length
}

beforeEach(() => {
	vi.clearAllMocks()
	clear_records()
	repository.tree = AFTER_FIX
	repository.base = BASE
})

afterEach(clear_records)

describe('owed_bump_gate — the one shape that pays for two gates', () => {
	it('answers with the record when a pre-bump gate covered this same work', () => {
		record_green(BEFORE_FIX, BASE)

		expect(owed(AFTER_FIX, BASE)).toBe(true)
	})

	// The gate started beside `/code-review` is the first of the run: no record exists yet, so nothing
	// here can refuse it.
	it('stays silent when no gate has run on this branch', () => {
		expect(owed(AFTER_FIX, BASE)).toBe(false)
	})

	// The re-run after the bump. `package.json` is in the map, so the bump is no longer owed.
	it('stays silent once the version bump is in the tree', () => {
		record_green(BEFORE_FIX, BASE)

		expect(owed(AFTER_BUMP, BASE)).toBe(false)
	})

	// The map's keys are repository-root-relative, so in a monorepo package the bump lands under a
	// prefix. Matched by basename, or the bump would stay owed forever and every gate after the first
	// green one would be refused.
	it('stays silent when the bump landed in a package below the repository root', () => {
		record_green(BEFORE_FIX, BASE)

		expect(owed({ ...AFTER_FIX, [NESTED_MANIFEST]: VERSION_DIGEST }, BASE)).toBe(false)
	})
})

// Split from the block above only because the two together outrun the per-function line limit; the
// cases here are all one thing — a record that exists but cannot speak for this run.
describe('owed_bump_gate — a record that cannot speak for this run', () => {
	// A record left by a previous run that followed the prescribed order was taken after that run's
	// bump, so it carries `package.json` and can never be the one that refuses.
	it('stays silent when the record itself was taken after a bump', () => {
		record_green(AFTER_BUMP, BASE)

		expect(owed(AFTER_FIX, BASE)).toBe(false)
	})

	// A record from an abandoned run on another branch. Where the default branch has not moved in
	// between, the base check alone lets it through — the shared path is what stops it.
	it('stays silent when the record covers different work', () => {
		record_green(OTHER_WORK, BASE)

		expect(owed(AFTER_FIX, BASE)).toBe(false)
	})

	// The discriminator the base check cannot supply: a run abandoned on the same base, one of whose
	// files this tree no longer changes at all. Its record must not refuse the *first* gate of the run
	// that follows it.
	it('stays silent when the record covers a path this tree no longer changes', () => {
		record_green({ ...BEFORE_FIX, ...OTHER_WORK }, BASE)

		expect(owed(AFTER_FIX, BASE)).toBe(false)
	})

	// A record with an empty map is a subset of every tree and speaks for no file, so it is refused
	// outright rather than read as covering this work.
	it('stays silent when the record covers nothing at all', () => {
		record_green({}, BASE)

		expect(owed(AFTER_FIX, BASE)).toBe(false)
	})

	it('stays silent when the record was taken against another base', () => {
		record_green(BEFORE_FIX, ADVANCED_BASE)

		expect(owed(AFTER_FIX, BASE)).toBe(false)
	})

	it('stays silent when the base could not be read at all', () => {
		record_green(BEFORE_FIX, BASE)

		expect(owed(AFTER_FIX, undefined)).toBe(false)
	})
})

describe('format_refusal', () => {
	const TAKEN_AT = '2026-09-06T04:05:06.000Z'
	const text = gate_bump_order.format_refusal(TAKEN_AT)

	it('says nothing was checked before it says anything else', () => {
		expect(text.startsWith('⚠ nothing was checked')).toBe(true)
	})

	it('names when the earlier gate was green', () => {
		expect(text).toContain(TAKEN_AT)
	})

	it('names both ways forward', () => {
		expect(text).toContain(BUMP_COMMAND)
		expect(text).toContain(gate_skip.FORCE_FLAG)
	})

	// The gate's own verdict line is `josh_verdict`'s to build. A refusal that carried it would be
	// counted as a failed call, and the re-run after it charged as rework (joshuafolkken/kit#1374).
	it('claims neither of the gate verdicts', () => {
		expect(text).not.toContain('verification gate failed')
		expect(text).not.toContain('verification gate passed')
	})

	// The command reference prints this message as a sample transcript, and a transcript nothing pins
	// drifts back to whatever the message used to say — silently, since it is inside a code fence. The
	// two openers are asserted rather than the whole text: the timestamp is a real run's.
	it.each(['  Where this run will commit:', '  Where it will not ('])(
		'is quoted in the command reference, line %j included',
		(opener) => {
			expect(text).toContain(opener)
			expect(read_repo_file('docs/josh-commands.md')).toContain(opener)
		},
	)
})

describe('run_verification_gate — a bump the run still owes', () => {
	beforeEach(() => {
		record_green(BEFORE_FIX, BASE)
	})

	it('starts none of the four checks', async () => {
		const [code] = await run_gate()

		expect(code).toBe(REFUSED_EXIT_CODE)
		expect(check_count()).toBe(NOTHING_RAN)
	})

	it('says why, and what to run instead', async () => {
		const [, text] = await run_gate()

		expect(text).toContain('nothing was checked')
		expect(text).toContain(BUMP_COMMAND)
	})

	// The plan describes a fan-out; a refusal started no process for it to describe.
	it('announces no plan it did not carry out', async () => {
		const [, text] = await run_gate()

		expect(text).not.toContain('plan:')
	})

	it('runs all four checks when the caller forces them', async () => {
		const [code] = await run_gate(true)

		expect(code).toBe(PASS)
		expect(check_count()).toBe(CHECK_COUNT)
	})
})

describe('run_verification_gate — the two legitimate gates around a bump', () => {
	it('runs all four for the first gate of a run', async () => {
		const [code] = await run_gate()

		expect(code).toBe(PASS)
		expect(check_count()).toBe(CHECK_COUNT)
	})

	it('runs all four for the re-run after the bump', async () => {
		record_green(BEFORE_FIX, BASE)
		repository.tree = AFTER_BUMP

		const [code] = await run_gate()

		expect(code).toBe(PASS)
		expect(check_count()).toBe(CHECK_COUNT)
	})
})
