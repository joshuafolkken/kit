import { git_command } from '#scripts/git/git-command'
import { git_gh_command } from '#scripts/git/git-gh-command'
import { git_pr_checks } from '#scripts/git/git-pr-checks'
import { main_sync } from '#scripts/git/main-sync'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OBSERVATION_LEDGER_PATH } from './observation-ledger'
import { observations_flush } from './observations-flush'
import {
	DEFAULT_BRANCH,
	FLUSH_BRANCH,
	MODIFIED_LEDGER,
	MORNING_INSTANT,
	MS_COMMAND,
	ONLY_COPY,
} from './observations-flush-fixture'

// This file drives `observations_flush.flush()` against a mocked git — the whole command, both the
// success path (joshuafolkken/kit#1795) and the rollbacks (joshuafolkken/kit#1785). `git_command` and
// the gh / checks / main-sync collaborators are mocked because the assertions are about the order this
// module drives them in, not about git or GitHub themselves — the flags of each call belong to those
// modules' own tests.
//
// **Why a mocked-git unit test rather than an integration test** (joshuafolkken/kit#1795). The issue
// asks the success path to be exercised without writing to real GitHub or the default branch. A unit
// test against mocked git pins the exact command sequence, runs offline and deterministically, and
// reuses the harness #1785 already built. The integration alternative — a temporary repository with a
// local bare remote — was rejected: the success path's middle is `pr_create` -> `wait_for_pr_success`
// -> `pr_merge`, which run through the `gh` CLI against the GitHub API, and a local remote can neither
// open a pull request nor report its checks. Covering those steps in an integration test would
// therefore require the real GitHub the acceptance criteria forbid, so it could exercise only the
// branch/commit/push prefix — strictly less than this test, at more cost.

vi.mock('#scripts/git/git-command', () => ({
	git_command: {
		add_path: vi.fn(),
		branch: vi.fn(),
		checkout: vi.fn(),
		checkout_b: vi.fn(),
		commit: vi.fn(),
		commit_count_beyond: vi.fn(),
		delete_branch: vi.fn(),
		get_default_branch: vi.fn(),
		push: vi.fn(),
		status: vi.fn(),
	},
}))
vi.mock('#scripts/git/git-gh-command', () => ({
	git_gh_command: { pr_create: vi.fn(), pr_merge: vi.fn() },
}))
vi.mock('#scripts/git/git-pr-checks', () => ({
	git_pr_checks: { wait_for_pr_success: vi.fn() },
}))
vi.mock('#scripts/git/main-sync', () => ({ main_sync: { run: vi.fn() } }))

const HOOK_REJECTION = 'cspell found an unknown word'
const CHECKOUT_FAILURE = 'index.lock exists'
const PULL_REQUEST_URL = 'https://github.com/joshuafolkken/kit/pull/1'
const NO_COMMITS = 0
const SUCCESS_EXIT_CODE = 0

// The collaborators the success path drives, listed in the order `flush` is expected to call them:
// branch -> stage -> commit -> push -> open -> wait -> merge -> return. Pinning their first-call
// order as a strictly increasing sequence is one assertion for the whole path.
type MockedCommand = (...args: Array<never>) => unknown
const SUCCESS_SEQUENCE: ReadonlyArray<MockedCommand> = [
	git_command.checkout_b,
	git_command.add_path,
	git_command.commit,
	git_command.push,
	git_gh_command.pr_create,
	git_pr_checks.wait_for_pr_success,
	git_gh_command.pr_merge,
	main_sync.run,
]

function first_call_order(command: MockedCommand): number {
	const [order] = vi.mocked(command).mock.invocationCallOrder

	return order ?? NaN
}

function on_default_branch(): void {
	vi.mocked(git_command.status).mockResolvedValue(MODIFIED_LEDGER)
	vi.mocked(git_command.branch).mockResolvedValue(DEFAULT_BRANCH)
	vi.mocked(git_command.get_default_branch).mockResolvedValue(DEFAULT_BRANCH)
	vi.mocked(git_command.checkout_b).mockResolvedValue('')
	vi.mocked(git_command.checkout).mockResolvedValue('')
	vi.mocked(git_gh_command.pr_create).mockResolvedValue(PULL_REQUEST_URL)
	vi.mocked(main_sync.run).mockResolvedValue(SUCCESS_EXIT_CODE)
}

// The message the command exits with, whichever side it came out of — so an arm can be asserted by
// what it says *and* by what it does not, which a bare `rejects.toThrow` substring cannot do.
async function flush_message(): Promise<string> {
	try {
		return await observations_flush.flush(new Date(MORNING_INSTANT))
	} catch (error) {
		return error instanceof Error ? error.message : String(error)
	}
}

async function rejected_flush(): Promise<string> {
	vi.mocked(git_command.commit).mockRejectedValue(new Error(HOOK_REJECTION))

	return await flush_message()
}

// The push -> PR -> merge path that had never run under a test before joshuafolkken/kit#1795.
describe('observations_flush — the success path command sequence', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		on_default_branch()
	})

	it('drives its steps in a strictly increasing call order', async () => {
		await observations_flush.flush(new Date(MORNING_INSTANT))

		const orders = SUCCESS_SEQUENCE.map((command) => first_call_order(command))

		expect(orders.every((order) => Number.isSafeInteger(order))).toBe(true)
		expect(orders).toEqual(orders.toSorted((left, right) => left - right))
	})

	it('cuts a fresh branch, commits the ledger, pushes, and opens the pull request', async () => {
		await observations_flush.flush(new Date(MORNING_INSTANT))

		expect(git_command.checkout_b).toHaveBeenCalledWith(FLUSH_BRANCH)
		expect(git_command.add_path).toHaveBeenCalledWith(OBSERVATION_LEDGER_PATH)
		expect(git_command.commit).toHaveBeenCalledWith(observations_flush.COMMIT_MESSAGE)
		expect(git_command.push).toHaveBeenCalled()
		expect(git_gh_command.pr_create).toHaveBeenCalledWith(
			observations_flush.COMMIT_MESSAGE,
			observations_flush.pull_request_body(),
		)
	})
})

describe('observations_flush — a merged flush', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		on_default_branch()
	})

	it('waits for checks, merges the branch, returns to default, and reports the merge', async () => {
		const message = await observations_flush.flush(new Date(MORNING_INSTANT))

		expect(git_pr_checks.wait_for_pr_success).toHaveBeenCalledWith(FLUSH_BRANCH)
		expect(git_gh_command.pr_merge).toHaveBeenCalledWith(FLUSH_BRANCH)
		expect(main_sync.run).toHaveBeenCalledWith([])
		expect(message).toContain(FLUSH_BRANCH)
		expect(message).toContain('default branch')
	})

	// The rollback path is what deletes a branch or checks the default branch back out; a merged flush
	// must do neither, so their absence is what separates a success from a silent rollback.
	it('never rolls the branch back', async () => {
		await observations_flush.flush(new Date(MORNING_INSTANT))

		expect(git_command.delete_branch).not.toHaveBeenCalled()
		expect(git_command.checkout).not.toHaveBeenCalled()
	})
})

// joshuafolkken/kit#1785: a commit rejected by the pre-commit hook used to leave the flush branch
// behind with no commit on it, and the refusal the next run printed named two exits — finish that
// branch, or delete it — that the distributed `.claude/settings.json` denies outright. What is pinned
// here is the rollback, which is the half the messages cannot pin: the side that created the branch
// removes it, the checkout goes back, and the appended lines stay in the working tree.

describe('observations_flush — a commit the pre-commit hook rejects', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		on_default_branch()
	})

	it('returns the checkout to the branch the flush started from', async () => {
		await rejected_flush()

		expect(git_command.checkout).toHaveBeenCalledWith(DEFAULT_BRANCH)
	})

	// The orphan branch is the whole defect: five of them were sitting in the checkout that filed
	// this issue, each one a flush whose commit was rejected.
	it('deletes the branch it had just created', async () => {
		await rejected_flush()

		expect(git_command.delete_branch).toHaveBeenCalledWith(FLUSH_BRANCH)
	})

	it('never reaches the push', async () => {
		await rejected_flush()

		expect(git_command.push).not.toHaveBeenCalled()
	})

	// The appended lines are staged and uncommitted throughout, so the rollback loses nothing and the
	// message says so rather than warning about a copy that does not exist.
	it('says the appended lines are still in the working tree', async () => {
		const message = await rejected_flush()

		expect(message).toContain('still in the working tree')
		expect(message).toContain(HOOK_REJECTION)
		expect(message).not.toContain(ONLY_COPY)
	})

	// The acceptance criterion the refusal used to break: with the branch gone and the checkout back
	// on the default branch, the very next flush is a fresh branch rather than a refusal.
	it('leaves the same command runnable immediately afterwards', async () => {
		await rejected_flush()
		vi.mocked(git_command.commit).mockResolvedValue(undefined)

		await expect(observations_flush.flush(new Date(MORNING_INSTANT))).resolves.toContain(
			FLUSH_BRANCH,
		)
	})
})

describe('observations_flush — a rollback that cannot finish', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		on_default_branch()
		vi.mocked(git_command.checkout).mockRejectedValue(new Error(CHECKOUT_FAILURE))
	})

	// The branch is still in the checkout, so a message asserting its removal would send somebody
	// looking for something that is still there. Both reasons ride in the one error instead.
	it('reports both reasons and claims no removal', async () => {
		const message = await rejected_flush()

		expect(message).toContain(HOOK_REJECTION)
		expect(message).toContain(CHECKOUT_FAILURE)
		expect(message).not.toContain('was removed')
	})
})

describe('observations_flush — a flush branch that is still in the checkout', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		on_default_branch()
		vi.mocked(git_command.branch).mockResolvedValue(FLUSH_BRANCH)
	})

	// **Both assertions are load-bearing**: the stranded message names `pnpm josh ms` too, so a
	// positive match alone passes with the two arms swapped.
	it('tells a zero-commit branch to return to the default branch and flush again', async () => {
		vi.mocked(git_command.commit_count_beyond).mockResolvedValue(NO_COMMITS)

		const message = await flush_message()

		expect(message).toContain(MS_COMMAND)
		expect(message).not.toContain(ONLY_COPY)
	})

	// A count nobody could read must not be reported as "nothing is stranded": that answer is the one
	// that loses lines, so an unreadable count takes the warning arm.
	it('warns about the only copy when the commit count cannot be read', async () => {
		vi.mocked(git_command.commit_count_beyond).mockRejectedValue(new Error('unknown revision'))

		await expect(flush_message()).resolves.toContain(ONLY_COPY)
	})
})
