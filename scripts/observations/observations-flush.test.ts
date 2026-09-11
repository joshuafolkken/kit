import { describe, expect, it } from 'vitest'
import { OBSERVATION_LEDGER_PATH } from './observation-ledger'
import { observations_flush } from './observations-flush'

// joshuafolkken/kit#1756: the flush is the observation ledger's only commit path, so what it refuses
// is the whole of its safety story. The refusals and the message a failed flush leaves behind are
// asserted here rather than the happy path, which is `git checkout -b` → push → merge against a real
// remote: the branch that cannot be unit-tested must not be the one deciding whether somebody else's
// work in progress gets committed, or whether a person is told to walk away from the only copy of an
// appended line.

const SOURCE_PATH = 'scripts/git/git-staging.ts'
const TEST_PATH = 'scripts/new.test.ts'
const MODIFIED_LEDGER = ` M ${OBSERVATION_LEDGER_PATH}`
const MODIFIED_SOURCE = ` M ${SOURCE_PATH}`
const UNTRACKED_TEST = `?? ${TEST_PATH}`
const MORNING_INSTANT = '2026-09-11T02:14:42Z'
const FLUSH_BRANCH = 'observations/2026-09-11-021442'
const PUSH_FAILURE = 'remote hung up'

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
		expect(body).toContain('pnpm josh observations:flush')
	})

	it('says the ledger is append-only in the diff a reviewer reads', () => {
		expect(observations_flush.pull_request_body()).toContain('append-only')
	})
})

describe('observations_flush — the refusals name what to do next', () => {
	it('names the command that returns the checkout to the default branch', () => {
		const message = observations_flush.off_default_branch_message('1756-lane', 'main')

		expect(message).toContain('1756-lane')
		expect(message).toContain('pnpm josh ms')
	})

	// The opposite advice, on the one branch where `pnpm josh ms` would discard the only copy of an
	// appended line: a flush branch holds its observations as a commit, so the working tree shows
	// nothing and a silent checkout loses them.
	it('does not send a stranded flush branch to pnpm josh ms', () => {
		const message = observations_flush.off_default_branch_message(FLUSH_BRANCH, 'main')

		expect(message).toContain(FLUSH_BRANCH)
		expect(message).toContain('only copy')
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
