import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { gate_skip } from './gate-skip'
import { gate_test_fixture } from './gate-test-fixture'
import { ALIASES, COMMAND_MAP } from './josh/josh-command-map'
import { review_stamps } from './review/review-stamps'

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

vi.mock('./review/review-tree', () => ({
	review_tree: {
		read_changed_tree: async (): Promise<Record<string, string>> => {
			refuse_when('tree')

			return repository.tree
		},
	},
}))

vi.mock('./git/git-command', () => ({
	git_command: {
		default_branch_commit: async (): Promise<string> => {
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

vi.mock('./test-unit-guard', () => ({ test_unit_guard: { run_guarded_unit } }))

const { pre_push_unit } = await import('./pre-push-unit')

const { capture_stdout } = gate_test_fixture

const SCRIPT_PATH = 'scripts/pre-push-unit.ts'
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
const SPEC_FILTER = '--project=unit'
const COMMAND_NAME = 'pre-push-unit'
const ALIAS = 'ppu'

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

// The hook's line names this command, so a command that is not registered is a push that fails on
// every repository the config reaches.
describe(`josh ${COMMAND_NAME} is registered`, () => {
	it('routes through the pre-push unit script', () => {
		expect(COMMAND_MAP[COMMAND_NAME]?.script).toBe(SCRIPT_PATH)
	})

	it('is reachable by its alias', () => {
		expect(ALIASES[ALIAS]).toBe(COMMAND_NAME)
	})
})
