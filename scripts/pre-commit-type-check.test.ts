import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { gate_skip } from './gate-skip'
import { gate_test_fixture } from './gate-test-fixture'
import { ALIASES, COMMAND_MAP } from './josh/josh-command-map'
import { review_stamps } from './review/review-stamps'

// joshuafolkken/kit#1381: the pre-commit hook type-checked the whole project seconds after `josh gate`
// had printed the same project-wide type check green on the same tree, with nothing edited in between.
//
// Two things are asserted here, and the second is the one a commit needs. The first is that the
// decision is joshuafolkken/kit#1328's and not a second copy of it — a moved file, a moved base and an
// empty map each refuse the reuse here exactly as they refuse it in the gate. The second is the
// condition this hook adds on top: the record describes the **working tree**, a commit carries the
// **index**, and the two are the same thing only while nothing is unstaged and nothing is untracked.

// **The scaffolding below mirrors `pre-push-unit.test.ts` rather than being shared with it, and that is
// forced rather than chosen.** `vi.mock` factories and `vi.hoisted` state are hoisted above every
// import, so neither can reference a fixture module — which is why `gate-test-fixture.ts` holds the
// stubs that *can* be shared (`capture_stdout`, `suite_records`) and nothing that has to be hoisted.
// What the two hooks genuinely share is the decision itself, and that lives in `hook-gate-reuse.ts`
// with a suite of its own.

interface Repo {
	tree: Record<string, string>
	base: string
	status: string
	unreadable: string
}

// Which of the three git readings refuses to answer, so each `catch` in `gate-tree.ts` and
// `hook-gate-reuse.ts` can be exercised on its own. A git failure means no reuse, never a crash and
// never a silent skip.
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

// What `type-check-step.ts` resolves the gate's type-check step to for this project. The default is
// this hook's own `tsc --noEmit`; a toolkit project's is not, and the record cannot tell them apart.
const gate_step = vi.hoisted((): { args: ReadonlyArray<string>; unreadable: boolean } => ({
	args: ['josh', 'check'],
	unreadable: false,
}))

vi.mock('./type-check-step', () => ({
	DEFAULT_TYPE_CHECK_ARGS: ['josh', 'check'],
	type_check_step: {
		resolve_type_check_args: async (): Promise<ReadonlyArray<string>> => {
			if (gate_step.unreadable) throw new Error('the toolkit shim could not be probed')

			return gate_step.args
		},
	},
}))

const TOOLKIT_STEP: ReadonlyArray<string> = ['josh-app', 'check:ci']
const DEFAULT_STEP: ReadonlyArray<string> = ['josh', 'check']
// Held in a variable so the lookup keeps its index-signature form: `COMMAND_MAP.check` is what the
// formatter rewrites a literal key to, and `noPropertyAccessFromIndexSignature` then refuses it.
const GATE_TYPE_CHECK_COMMAND = 'check'
// The one token of the hook's argv that names `pnpm exec` rather than the check itself.
const EXEC_TOKEN = 'exec'

const TYPE_CHECK_EXIT_CODE = 2

const execa = vi.hoisted(() => vi.fn(async (): Promise<{ exitCode: number }> => ({ exitCode: 0 })))

vi.mock('execa', () => ({ execa }))

const { pre_commit_type_check } = await import('./pre-commit-type-check')

const { capture_stdout, suite_records } = gate_test_fixture

const SCRIPT_PATH = 'scripts/pre-commit-type-check.ts'
const CHANGED_TREE: Record<string, string> = { [SCRIPT_PATH]: 'digest-one' }
const MOVED_TREE: Record<string, string> = { [SCRIPT_PATH]: 'digest-two' }
const EMPTY_TREE: Record<string, string> = {}
const BASE = 'a1b2c3d4'
const ADVANCED_BASE = 'e5f6a7b8'
const STAGED_ONLY = `M  ${SCRIPT_PATH}`
const UNSTAGED = ` M ${SCRIPT_PATH}`
const PARTIALLY_STAGED = `MM ${SCRIPT_PATH}`
const UNTRACKED = `?? ${SCRIPT_PATH}`
const NOTHING_RAN = 0
const CHECK_RAN = 1
const REFUSED_EXIT_CODE = 1
const FORCE_ENV = 'JOSH_PRE_COMMIT_FORCE'
const A_PATH = 'scripts/gate-skip.ts'
const COMMAND_NAME = 'pre-commit-type-check'
const ALIAS = 'ptc'

// This suite runs *inside* `pnpm josh gate`, which is itself reading and writing the shared record — so
// it plants its own rather than overwriting the one the live run relies on. Nothing here ever writes a
// record without naming this path, and the hook is never run without being handed it.
const { stamp_path, clear } = suite_records(COMMAND_NAME)

function record_green(files: Record<string, string>, base?: string): void {
	review_stamps.gate_stamp.write(files, stamp_path, base)
}

async function run_hook(extra_arguments: ReadonlyArray<string> = []): Promise<[number, string]> {
	const stdout = capture_stdout()

	try {
		const code = await pre_commit_type_check.run_pre_commit_type_check(extra_arguments, stamp_path)

		return [code, stdout.text()]
	} finally {
		stdout.restore()
	}
}

function check_run_count(): number {
	return execa.mock.calls.length
}

beforeEach(() => {
	vi.clearAllMocks()
	clear()
	repository.tree = CHANGED_TREE
	repository.base = BASE
	repository.status = STAGED_ONLY
	repository.unreadable = READS_FINE
	gate_step.args = DEFAULT_STEP
	gate_step.unreadable = false
	vi.stubEnv(FORCE_ENV, '')
})

afterEach(() => {
	clear()
	vi.unstubAllEnvs()
})

describe('the escape hatch is the variable the hook documents', () => {
	it('is named by the module the hook runs', () => {
		expect(pre_commit_type_check.FORCE_ENV).toBe(FORCE_ENV)
	})
})

describe('a green record that covers the tree this commit carries', () => {
	beforeEach(() => {
		record_green(CHANGED_TREE, BASE)
	})

	it('runs no type check at all', async () => {
		const [code] = await run_hook()

		expect(code).toBe(0)
		expect(check_run_count()).toBe(NOTHING_RAN)
	})

	// "skipped" on its own reads as "not verified", which is what the commit would then be resting on.
	it('says the tree is green rather than saying nothing ran', async () => {
		const [, text] = await run_hook()

		expect(text).toContain('this tree is already green')
		expect(text).toContain(FORCE_ENV)
	})

	it('runs the type check anyway when the escape hatch is set', async () => {
		vi.stubEnv(FORCE_ENV, '1')

		const [code] = await run_hook()

		expect(code).toBe(0)
		expect(check_run_count()).toBe(CHECK_RAN)
	})

	// The same instruction typed the other way round, at a command line rather than in front of a
	// commit. A flag read as "nothing to do here" would be the one spelling that silently does nothing.
	it('runs the type check anyway when the gate flag is passed', async () => {
		await run_hook([gate_skip.FORCE_FLAG])

		expect(check_run_count()).toBe(CHECK_RAN)
	})

	// `tsc --noEmit <file>` ignores tsconfig.json, so a forwarded path would narrow the very check this
	// command runs in full. Refused rather than dropped: ignoring it would look like it was honored.
	it('refuses any other argument instead of narrowing the check', async () => {
		const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)

		const [code] = await run_hook([A_PATH])

		expect(code).toBe(REFUSED_EXIT_CODE)
		expect(check_run_count()).toBe(NOTHING_RAN)
		expect(stderr.mock.calls[0]?.[0]).toContain(A_PATH)
		stderr.mockRestore()
	})
})

// A commit is what the hook guards, and it carries the index rather than the working tree the record
// describes. So this hook's condition is joshuafolkken/kit#1328's or stricter — never looser.
describe('a tree that is not the commit being made', () => {
	beforeEach(() => {
		record_green(CHANGED_TREE, BASE)
	})

	// One case per porcelain shape: an unstaged edit, a file staged and then edited again, and an
	// untracked file the record was green on that the commit does not carry.
	it.each([UNSTAGED, PARTIALLY_STAGED, UNTRACKED])(
		'runs the type check when the index does not match the working tree (%s)',
		async (status) => {
			repository.status = status

			await run_hook()

			expect(check_run_count()).toBe(CHECK_RAN)
		},
	)

	// The record says the four checks were green; it does not say which type check ran. On a project
	// whose gate step is the toolkit's, reusing it here would skip `tsc --noEmit` on the strength of a
	// different check.
	it('runs the type check when the gate ran a different type check for this project', async () => {
		gate_step.args = TOOLKIT_STEP

		await run_hook()

		expect(check_run_count()).toBe(CHECK_RAN)
	})

	// The same invariant as the git readings: a probe that could not be taken says nothing about which
	// check ran, so it must resolve to running the check rather than to a crash.
	it('runs the type check when the project’s type check step could not be resolved', async () => {
		gate_step.unreadable = true

		const [code] = await run_hook()

		expect(code).toBe(0)
		expect(check_run_count()).toBe(CHECK_RAN)
	})

	// A git command that could not be run says nothing about the tree, and "we could not tell" must
	// never resolve to "no need to check". One case per reading, because each is a separate `catch`.
	it.each(['status', 'tree', 'base'])(
		'runs the type check when the %s could not be read',
		async (reading) => {
			repository.unreadable = reading

			await run_hook()

			expect(check_run_count()).toBe(CHECK_RAN)
		},
	)
})

describe('a record that cannot speak for this tree', () => {
	// A red gate writes no record at all, so the run after a failure reaches this same branch.
	it('runs the type check when no record exists', async () => {
		await run_hook()

		expect(check_run_count()).toBe(CHECK_RAN)
	})

	it('runs the type check when a file it covers has moved', async () => {
		record_green(MOVED_TREE, BASE)

		await run_hook()

		expect(check_run_count()).toBe(CHECK_RAN)
	})

	// A rebase onto an advanced default branch: the same files still differ by the same digests, over a
	// working tree whose every other file has been replaced.
	it('runs the type check when only the default branch moved', async () => {
		record_green(CHANGED_TREE, ADVANCED_BASE)

		await run_hook()

		expect(check_run_count()).toBe(CHECK_RAN)
	})

	// `git switch main && git pull` empties the map, and two empty maps agree.
	it('runs the type check when the changed map is empty', async () => {
		repository.tree = EMPTY_TREE
		record_green(EMPTY_TREE, BASE)

		await run_hook()

		expect(check_run_count()).toBe(CHECK_RAN)
	})

	it('runs the type check when the record was written before the base was pinned', async () => {
		record_green(CHANGED_TREE)

		await run_hook()

		expect(check_run_count()).toBe(CHECK_RAN)
	})

	// The whole point of the hook: a type error has to block the commit, so the check's own exit code is
	// what this command answers with.
	it('answers with the type check exit code so a failure blocks the commit', async () => {
		execa.mockResolvedValueOnce({ exitCode: TYPE_CHECK_EXIT_CODE })

		const [code] = await run_hook()

		expect(code).toBe(TYPE_CHECK_EXIT_CODE)
	})
})

// The guard compares the gate's resolved step against `josh check` rather than against this hook's own
// argv, because that is what `type-check-step.ts` answers with. That the two are the same check is a
// real invariant, and leaving it unchecked would let a later redefinition of `josh check` reopen the
// hole the guard closes: the guard would still say yes while the record covered a different check.
describe('the recorded default step is this hook’s own check', () => {
	it.each(pre_commit_type_check.TYPE_CHECK_ARGUMENTS.filter((token) => token !== EXEC_TOKEN))(
		'josh check runs %s, so a record it wrote covers what this hook would run',
		(token) => {
			expect(COMMAND_MAP[GATE_TYPE_CHECK_COMMAND]?.shell).toContain(token)
		},
	)
})

// The hook's line names this command, so a command that is not registered is a commit that fails on
// every repository the config reaches.
describe(`josh ${COMMAND_NAME} is registered`, () => {
	it('routes through the pre-commit type check script', () => {
		expect(COMMAND_MAP[COMMAND_NAME]?.script).toBe(SCRIPT_PATH)
	})

	it('is reachable by its alias', () => {
		expect(ALIASES[ALIAS]).toBe(COMMAND_NAME)
	})
})
