import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { core_budget } from '#scripts/gate/core-budget'
import { gate_skip } from '#scripts/gate/gate-skip'
import { gate_test_fixture } from '#scripts/gate/gate-test-fixture'
import { pre_push_related_switch } from '#scripts/hooks/pre-push-related-switch'
import { COMMAND_MAP } from '#scripts/josh/josh-command-map'
import { review_stamps } from '#scripts/review/review-stamps'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// joshuafolkken/kit#1334: the pre-push hook ran the whole unit suite 40 seconds after `josh gate`
// had printed it green on the same tree, with nothing edited in between.
//
// Two things are asserted here, and the second is the one a push needs. The first is that the
// decision is joshuafolkken/kit#1328's and not a second copy of it — a moved file, a moved base and
// an empty map each refuse the reuse here exactly as they refuse it in the gate. The second is the
// condition this hook adds on top: the record describes the **working tree**, a push carries
// **HEAD**, and the two are the same thing only while nothing is uncommitted.

interface Repo {
	tree: Record<string, string>
	base: string
	status: string
	unreadable: string
}

// Which of the three git readings refuses to answer, so each `catch` in `gate-tree.ts` and
// `pre-push-unit.ts` can be exercised on its own. They encode the decision the whole feature rests
// on — a git failure means no reuse, never a crash and never a silent skip.
const READS_FINE = ''

const repository = vi.hoisted((): Repo => ({
	tree: {},
	base: '',
	status: '',
	unreadable: '',
}))

function refuse_when(name: string): void {
	if (repository.unreadable === name) throw new Error(`git ${name} is unavailable`)
}

vi.mock('#scripts/review/review-tree', () => ({
	review_tree: {
		read_changed_tree: async (): Promise<Record<string, string>> => {
			refuse_when('tree')

			return repository.tree
		},
	},
}))

vi.mock('#scripts/git/git-command', () => ({
	git_command: {
		change_base_commit: async (): Promise<string> => {
			refuse_when('base')

			return repository.base
		},
		status: async (): Promise<string> => {
			refuse_when('status')

			return repository.status
		},
	},
}))

const run_guarded_unit = vi.hoisted(() => vi.fn(async (): Promise<number> => 0))

vi.mock('#scripts/test/test-unit-guard', () => ({ test_unit_guard: { run_guarded_unit } }))

const run_related_tests = vi.hoisted(() => vi.fn(async (): Promise<number> => 0))

vi.mock('#scripts/test/test-related', () => ({ test_related: { run_related_tests } }))

const { pre_push_unit } = await import('./pre-push-unit')

const { capture_stdout } = gate_test_fixture

const SCRIPT_PATH = 'scripts/hooks/pre-push-unit.ts'
const CHANGED_TREE: Record<string, string> = { [SCRIPT_PATH]: 'digest-one' }
const MOVED_TREE: Record<string, string> = { [SCRIPT_PATH]: 'digest-two' }
const EMPTY_TREE: Record<string, string> = {}
const BASE = 'a1b2c3d4'
const ADVANCED_BASE = 'e5f6a7b8'
const CLEAN = ''
const UNCOMMITTED = ` M ${SCRIPT_PATH}`
const NOTHING_RAN = 0
const SUITE_RAN = 1
const FORCE_ENV = 'JOSH_PRE_PUSH_FORCE'
const RELATED_ENV = pre_push_related_switch.SWITCH_ENV_KEY
const RELATED_ON = pre_push_related_switch.SWITCH_ON
const SPEC_FILTER = '--project=unit'
const COMMAND_NAME = 'pre-push-unit'

// This suite runs *inside* `pnpm josh gate`, which is itself reading and writing the shared record —
// so it plants its own rather than overwriting the one the live run relies on.
const STAMP_PATH = path.join(tmpdir(), `josh-pre-push-unit-stamp-${String(process.pid)}.json`)

function record_green(files: Record<string, string>, base?: string): void {
	review_stamps.gate_stamp.write(files, STAMP_PATH, base)
}

async function run_hook(extra_arguments: ReadonlyArray<string> = []): Promise<[number, string]> {
	const stdout = capture_stdout()

	try {
		const code = await pre_push_unit.run_pre_push_unit(extra_arguments, STAMP_PATH)

		return [code, stdout.text()]
	} finally {
		stdout.restore()
	}
}

function suite_run_count(): number {
	return run_guarded_unit.mock.calls.length
}

beforeEach(() => {
	vi.clearAllMocks()
	rmSync(STAMP_PATH, { force: true })
	repository.tree = CHANGED_TREE
	repository.base = BASE
	repository.status = CLEAN
	repository.unreadable = READS_FINE
	vi.stubEnv(FORCE_ENV, '')
	// joshuafolkken/kit#5187: `josh ship`'s push ahead of the gate runs this file under the switch it
	// tests, so every test pins it off and only the ones about it switch it on.
	vi.stubEnv(RELATED_ENV, '')
})

afterEach(() => {
	rmSync(STAMP_PATH, { force: true })
	vi.unstubAllEnvs()
})

describe('the escape hatch is the variable the hook documents', () => {
	it('is named by the module the hook runs', () => {
		expect(pre_push_unit.FORCE_ENV).toBe(FORCE_ENV)
	})
})

describe('a green record that covers the tree this push carries', () => {
	beforeEach(() => {
		record_green(CHANGED_TREE, BASE)
	})

	it('runs no unit suite at all', async () => {
		const [code] = await run_hook()

		expect(code).toBe(0)
		expect(suite_run_count()).toBe(NOTHING_RAN)
	})

	// "skipped" on its own reads as "not verified", which is what the push would then be resting on.
	it('says the tree is green rather than saying nothing ran', async () => {
		const [, text] = await run_hook()

		expect(text).toContain('this tree is already green')
		expect(text).toContain(FORCE_ENV)
	})

	it('runs the suite anyway when the escape hatch is set', async () => {
		vi.stubEnv(FORCE_ENV, '1')

		const [code] = await run_hook()

		expect(code).toBe(0)
		expect(suite_run_count()).toBe(SUITE_RAN)
	})

	// The same instruction typed the other way round, at a command line rather than in front of a
	// push. A flag that was read as "nothing to do here" would be the one spelling that silently does
	// nothing.
	it('runs the suite anyway when the gate flag is passed', async () => {
		await run_hook([gate_skip.FORCE_FLAG])

		expect(suite_run_count()).toBe(SUITE_RAN)
	})

	// A caller who narrowed the run to one spec asked for that run, not for a record about a tree.
	it('runs the suite when any other argument is passed, and forwards it', async () => {
		await run_hook([SPEC_FILTER])

		expect(run_guarded_unit).toHaveBeenCalledWith(expect.any(String), [SPEC_FILTER])
	})

	// vitest would refuse the flag, so it is consumed rather than passed on.
	it('does not forward the gate flag to vitest', async () => {
		await run_hook([gate_skip.FORCE_FLAG, SPEC_FILTER])

		expect(run_guarded_unit).toHaveBeenCalledWith(expect.any(String), [SPEC_FILTER])
	})
})

// A push puts code where CI and other people read it, so this hook's condition is joshuafolkken/kit#1328's
// or stricter — never looser. The record describes the working tree; the push carries HEAD.
describe('a tree that is not the commit being pushed', () => {
	beforeEach(() => {
		record_green(CHANGED_TREE, BASE)
	})

	it('runs the suite when changes are left uncommitted', async () => {
		repository.status = UNCOMMITTED

		await run_hook()

		expect(suite_run_count()).toBe(SUITE_RAN)
	})

	// A git command that could not be run says nothing about the tree, and "we could not tell" must
	// never resolve to "no need to check" — the one direction a push cannot afford. One case per
	// reading, because each is a separate `catch` and a shared assertion would pass on any one of them.
	it.each(['status', 'tree', 'base'])(
		'runs the suite when the %s could not be read',
		async (reading) => {
			repository.unreadable = reading

			await run_hook()

			expect(suite_run_count()).toBe(SUITE_RAN)
		},
	)
})

describe('a record that cannot speak for this tree', () => {
	// A red gate writes no record at all, so the run after a failure reaches this same branch.
	it('runs the suite when no record exists', async () => {
		await run_hook()

		expect(suite_run_count()).toBe(SUITE_RAN)
	})

	it('runs the suite when a file it covers has moved', async () => {
		record_green(MOVED_TREE, BASE)

		await run_hook()

		expect(suite_run_count()).toBe(SUITE_RAN)
	})

	// A rebase onto an advanced default branch: the same files still differ by the same digests, over
	// a working tree whose every other file has been replaced.
	it('runs the suite when only the default branch moved', async () => {
		record_green(CHANGED_TREE, ADVANCED_BASE)

		await run_hook()

		expect(suite_run_count()).toBe(SUITE_RAN)
	})

	// `git switch main && git pull` empties the map, and two empty maps agree.
	it('runs the suite when the changed map is empty', async () => {
		repository.tree = EMPTY_TREE
		record_green(EMPTY_TREE, BASE)

		await run_hook()

		expect(suite_run_count()).toBe(SUITE_RAN)
	})

	it('runs the suite when the record was written before the base was pinned', async () => {
		record_green(CHANGED_TREE)

		await run_hook()

		expect(suite_run_count()).toBe(SUITE_RAN)
	})
})

// joshuafolkken/kit#3307: a push that fell back to the whole suite said nothing about why, so a moved
// merge base, a dirty tree and a mismatched record could not be told apart from the log.
describe('a fall back to the whole suite names its reason in one line', () => {
	const MISS_LEAD = 'the green gate record does not cover this push: '

	it('names the moved merge base', async () => {
		record_green(CHANGED_TREE, ADVANCED_BASE)

		const [, text] = await run_hook()

		expect(text).toContain(
			`${MISS_LEAD}the merge base moved since the green gate (${ADVANCED_BASE} → ${BASE}).`,
		)
	})

	it('names the paths that leave the working tree dirty', async () => {
		record_green(CHANGED_TREE, BASE)
		repository.status = ' M pnpm-lock.yaml'

		const [, text] = await run_hook()

		expect(text).toContain(`${MISS_LEAD}the working tree differs from HEAD ( M pnpm-lock.yaml).`)
	})

	it('names a missing record', async () => {
		const [, text] = await run_hook()

		expect(text).toContain(`${MISS_LEAD}no green gate record matches the changed files.`)
	})

	it('names an unreadable status', async () => {
		record_green(CHANGED_TREE, BASE)
		repository.unreadable = 'status'

		const [, text] = await run_hook()

		expect(text).toContain(`${MISS_LEAD}git status could not be read.`)
	})

	it('prints no reason when the record is reused', async () => {
		record_green(CHANGED_TREE, BASE)

		const [, text] = await run_hook()

		expect(text).not.toContain(MISS_LEAD)
	})
})

// joshuafolkken/kit#5067: `josh ship` pushes its sync merge ahead of the gate, whose whole suite runs
// over the same tree next, so that push asks for the related tests instead.
describe('a push ahead of its gate runs the related tests', () => {
	beforeEach(() => {
		vi.stubEnv(RELATED_ENV, RELATED_ON)
	})

	it('runs the related tests, not the whole suite, when no record covers the push', async () => {
		const [code, text] = await run_hook()

		expect(code).toBe(0)
		expect(run_related_tests).toHaveBeenCalledWith([])
		expect(suite_run_count()).toBe(NOTHING_RAN)
		expect(text).toContain('running the related unit tests')
	})

	it('still reuses a record that covers the push', async () => {
		record_green(CHANGED_TREE, BASE)

		await run_hook()

		expect(run_related_tests).not.toHaveBeenCalled()
	})

	it('runs the whole suite when the escape hatch is set too', async () => {
		vi.stubEnv(FORCE_ENV, '1')

		await run_hook()

		expect(run_related_tests).not.toHaveBeenCalled()
		expect(suite_run_count()).toBe(SUITE_RAN)
	})

	it('runs the whole suite without the switch', async () => {
		vi.stubEnv(RELATED_ENV, '')

		await run_hook()

		expect(run_related_tests).not.toHaveBeenCalled()
		expect(suite_run_count()).toBe(SUITE_RAN)
	})
})

// The hook's line names this command, so a command that is not registered is a push that fails on
// every repository the config reaches.
// joshuafolkken/kit#3874: a push's whole suite ran beside other lanes' gates without a place in the core
// budget, so their admission read its workers as load from outside the ledger.
describe('the whole suite holds a place in the core budget', () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('reserves the direct unit weight before it runs the suite', async () => {
		const reservation = vi
			.spyOn(core_budget, 'with_command_reservation')
			.mockImplementation(async (_weight, run) => await run())

		await run_hook()

		expect(reservation).toHaveBeenCalledTimes(1)
		expect(reservation.mock.calls[0]?.[0]).toBeGreaterThanOrEqual(1)
		expect(reservation.mock.calls[0]?.[2]?.is_unit).toBe(true)
		expect(suite_run_count()).toBe(SUITE_RAN)
	})

	// A claim on the reuse path could make a push wait out a full ledger for a suite it then skips.
	it('reserves nothing when the green record is reused', async () => {
		const reservation = vi.spyOn(core_budget, 'with_command_reservation')

		record_green(CHANGED_TREE, BASE)
		await run_hook()

		expect(reservation).not.toHaveBeenCalled()
	})

	it('reserves the same weight before it runs the related tests ahead of the gate', async () => {
		const reservation = vi
			.spyOn(core_budget, 'with_command_reservation')
			.mockImplementation(async (_weight, run) => await run())

		vi.stubEnv(RELATED_ENV, RELATED_ON)
		await run_hook()

		expect(reservation).toHaveBeenCalledTimes(1)
		expect(reservation.mock.calls[0]?.[2]?.command).toBe('pre-push test:related')
		expect(reservation.mock.calls[0]?.[2]?.is_unit).toBe(true)
		expect(run_related_tests).toHaveBeenCalledWith([])
	})
})

describe(`josh ${COMMAND_NAME} is registered`, () => {
	it('routes through the pre-push unit script', () => {
		expect(COMMAND_MAP[COMMAND_NAME]?.script).toBe(SCRIPT_PATH)
	})
})
