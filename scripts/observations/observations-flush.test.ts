import { describe, expect, it } from 'vitest'
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

// joshuafolkken/kit#1756: the flush is the observation ledger's only commit path, so what it refuses
// is the whole of its safety story. The refusals and the message a failed flush leaves behind are
// asserted here rather than the happy path, which is `git checkout -b` → push → merge against a real
// remote: the branch that cannot be unit-tested must not be the one deciding whether somebody else's
// work in progress gets committed, or whether a person is told to walk away from the only copy of an
// appended line.

const SOURCE_PATH = 'scripts/git/git-staging.ts'
const TEST_PATH = 'scripts/new.test.ts'
const MODIFIED_SOURCE = ` M ${SOURCE_PATH}`
const UNTRACKED_TEST = `?? ${TEST_PATH}`
const PUSH_FAILURE = 'remote hung up'
const NO_COMMITS = 0
const ONE_COMMIT = 1
const FLUSH_COMMAND = 'pnpm josh observations:flush'
const ROLL_BACK_FAILURE = 'permission denied'

function roll_back_failure(): string {
	return observations_flush.roll_back_failure_message(FLUSH_BRANCH, PUSH_FAILURE, ROLL_BACK_FAILURE)
}

describe('observations_flush — what a status output means', () => {
	it('sees a ledger change in the porcelain output', () => {
		expect(observations_flush.has_ledger_change(MODIFIED_LEDGER)).toBe(true)
	})

	it('does not see one in a tree holding other work only', () => {
		expect(observations_flush.has_ledger_change(MODIFIED_SOURCE)).toBe(false)
	})

	it('reports every other changed path, tracked or not', () => {
		const status = [MODIFIED_LEDGER, MODIFIED_SOURCE, UNTRACKED_TEST].join('\n')

		expect(observations_flush.other_changed_paths(status)).toEqual([SOURCE_PATH, TEST_PATH])
	})

	it('reports nothing else when the ledger is the only change', () => {
		expect(observations_flush.other_changed_paths(MODIFIED_LEDGER)).toEqual([])
	})
})

describe('observations_flush — the branch a flush opens', () => {
	// Two flushes must not collide on a name, which is what buys this command its freedom from the
	// "that branch already exists" recovery path `pnpm josh release` needs.
	it('stamps the branch to the second', () => {
		const stamp = observations_flush.timestamp_for(new Date(MORNING_INSTANT))

		expect(observations_flush.branch_name_for(stamp)).toBe(FLUSH_BRANCH)
	})

	// A minute-resolution stamp would make a retry after a failed push collide with the branch that
	// failure left behind, which is exactly when a retry happens.
	it('separates two flushes a second apart', () => {
		const first = observations_flush.timestamp_for(new Date(MORNING_INSTANT))
		const second = observations_flush.timestamp_for(new Date('2026-09-11T02:14:43Z'))

		expect(first).not.toBe(second)
	})
})

describe('observations_flush — the pull request it opens', () => {
	// A flush answers to no single issue, so a `closes #N` would close whichever issue the number
	// happened to name — the ledger's own lines are where each observation says what it is about.
	it('carries no closing keyword', () => {
		expect(observations_flush.pull_request_body()).not.toContain('closes #')
	})

	it('names the ledger and the command that opened it', () => {
		const body = observations_flush.pull_request_body()

		expect(body).toContain(OBSERVATION_LEDGER_PATH)
		expect(body).toContain(FLUSH_COMMAND)
	})

	it('says the ledger is append-only in the diff a reviewer reads', () => {
		expect(observations_flush.pull_request_body()).toContain('append-only')
	})
})

describe('observations_flush — the refusals name what to do next', () => {
	it('names the command that returns the checkout to the default branch', () => {
		const message = observations_flush.off_default_message('1756-lane', DEFAULT_BRANCH)

		expect(message).toContain('1756-lane')
		expect(message).toContain(MS_COMMAND)
	})

	// joshuafolkken/kit#1768: a default branch behind origin cuts a branch that conflicts by
	// construction, so the refusal names the branch, the remote it is behind, and `pnpm josh ms`.
	it('sends a stale default branch to pnpm josh ms before cutting a branch', () => {
		const message = observations_flush.behind_default_message(DEFAULT_BRANCH)

		expect(message).toContain(DEFAULT_BRANCH)
		expect(message).toContain(`origin/${DEFAULT_BRANCH}`)
		expect(message).toContain(MS_COMMAND)
	})

	// The opposite advice, on the one branch where `pnpm josh ms` would discard the only copy of an
	// appended line: a flush branch holds its observations as a commit, so the working tree shows
	// nothing and a silent checkout loses them.
	it('does not send a stranded flush branch to pnpm josh ms', () => {
		const message = observations_flush.flush_branch_message(FLUSH_BRANCH, ONE_COMMIT)

		expect(message).toContain(FLUSH_BRANCH)
		expect(message).toContain(ONLY_COPY)
	})

	// joshuafolkken/kit#1785: the exits it used to name — finish the branch, or delete it — are both
	// denied to an agent by the distributed `.claude/settings.json`, so the message has to name the
	// one route that is open.
	it('sends a committed flush branch to a push it is allowed to make', () => {
		const message = observations_flush.flush_branch_message(FLUSH_BRANCH, ONE_COMMIT)

		expect(message).toContain('git push -u origin')
		expect(message).not.toContain('Finish or delete')
	})

	// The premise of the message above does not hold with no commit on the branch: the lines are still
	// in the working tree, so nothing is stranded and `pnpm josh ms` is the correct exit.
	it('does not call a zero-commit flush branch the only copy', () => {
		const message = observations_flush.flush_branch_message(FLUSH_BRANCH, NO_COMMITS)

		expect(message).toContain(FLUSH_BRANCH)
		expect(message).not.toContain(ONLY_COPY)
		expect(message).toContain(MS_COMMAND)
	})
})

describe('observations_flush — what a rejected commit reports', () => {
	// A rollback that could not finish must not be reported as one that did: the branch is still in
	// the checkout, so the message carries both reasons and names the exit that is actually open.
	it('carries both reasons when the rollback could not finish', () => {
		const message = roll_back_failure()

		expect(message).toContain(PUSH_FAILURE)
		expect(message).toContain(ROLL_BACK_FAILURE)
		expect(message).toContain(MS_COMMAND)
	})

	// Asserting a removal that did not happen is what sends somebody looking for a branch that is
	// still sitting there, so this arm never claims one.
	it('does not claim the branch was removed when the rollback failed', () => {
		const message = roll_back_failure()

		expect(message).not.toContain('was removed')
		expect(message).not.toContain(ONLY_COPY)
	})

	// The message printed after a successful rollback describes what is already true, so it must not
	// send anyone to a branch that no longer exists.
	it('says the appended lines survived a rejected commit', () => {
		const message = observations_flush.rejected_commit_message(FLUSH_BRANCH, PUSH_FAILURE)

		expect(message).toContain('still in the working tree')
		expect(message).toContain(FLUSH_COMMAND)
	})

	it('names every path it refused to commit', () => {
		const message = observations_flush.other_changes_message([SOURCE_PATH, TEST_PATH])

		expect(message).toContain(SOURCE_PATH)
		expect(message).toContain(TEST_PATH)
	})

	// Any failure after the commit — a push, a `gh pr create`, a red check — leaves work nowhere the
	// working tree can show it, so the message has to say where it went and that the checkout is
	// still sitting on it.
	it('says where the lines are when a flush fails after committing', () => {
		const message = observations_flush.stranded_branch_message(FLUSH_BRANCH, PUSH_FAILURE)

		expect(message).toContain(FLUSH_BRANCH)
		expect(message).toContain(PUSH_FAILURE)
	})

	it('says there is nothing to flush rather than failing', () => {
		expect(observations_flush.CLEAN_MESSAGE).toContain('clean')
	})
})
