import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { git_command } from '#scripts/git/git-command'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_review_pinned } from './run-review-pinned'
import { run_review_pinned_accepted } from './run-review-pinned-accepted'

// joshuafolkken/kit#4775: a reason an earlier run on the branch accepted carries a later run with none
// past the same places, and only those.

const REASON = 'the branch only logs'
const SITE = 'scripts/a.ts 0123456789abcdef'
const OTHER_SITE = 'scripts/b.ts 89abcdef01234567'
const BRANCH = '4775-lane'

const scratch = { directory: '' }

beforeEach(() => {
	scratch.directory = mkdtempSync(path.join(tmpdir(), 'run-review-pinned-accepted-'))
	vi.spyOn(git_command, 'git_directories').mockResolvedValue([scratch.directory])
	vi.spyOn(git_command, 'branch').mockResolvedValue(BRANCH)
})

afterEach(() => {
	vi.restoreAllMocks()
	rmSync(scratch.directory, { recursive: true, force: true })
})

async function accept(unpinned: ReadonlyArray<string>): Promise<void> {
	await run_review_pinned_accepted.judge({ text: 'LIST\n', unpinned }, REASON)
}

async function later(
	unpinned: ReadonlyArray<string>,
): ReturnType<typeof run_review_pinned_accepted.judge> {
	return await run_review_pinned_accepted.judge({ text: 'L\n', unpinned }, undefined)
}

describe('run_review_pinned_accepted.judge — the record', () => {
	it('records the reason and the places it accepted in the git directory', async () => {
		await accept([SITE])

		const target = path.join(scratch.directory, run_review_pinned_accepted.RECORD_NAME)
		const recorded: unknown = JSON.parse(readFileSync(target, 'utf8'))

		expect(recorded).toStrictEqual({ branch: BRANCH, reason: REASON, unpinned: [SITE] })
	})
})

describe('run_review_pinned_accepted.judge — the reason an earlier run accepted', () => {
	it('accepts a later run with no reason under the recorded one while every place is recorded', async () => {
		await accept([SITE, OTHER_SITE])

		expect(await later([SITE])).toStrictEqual({
			kind: 'accepted',
			text: `L\nUnpinned accepted by an earlier run on this branch: ${REASON}\n`,
		})
	})

	it('stops a later run with a place the record does not hold', async () => {
		await accept([SITE])

		expect(await later([SITE, OTHER_SITE])).toStrictEqual({
			kind: 'stop',
			text: `L\n${run_review_pinned.STOP_NOTE}\n`,
		})
	})

	it("stops on another branch's record", async () => {
		await accept([SITE])
		vi.mocked(git_command.branch).mockResolvedValue('other-branch')

		const verdict = await later([SITE])

		expect(verdict.kind).toBe('stop')
	})

	it('stops when there is no git directory to hold a record', async () => {
		vi.mocked(git_command.git_directories).mockResolvedValue([])
		await accept([SITE])

		const verdict = await later([SITE])

		expect(verdict.kind).toBe('stop')
	})
})
