import { beforeEach, describe, expect, it, vi } from 'vitest'

const josh_run_mock = vi.hoisted(() => vi.fn())
const is_linked_mock = vi.hoisted(() => vi.fn())
const is_child_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/josh/josh-run', () => ({ josh_command: { josh_run: josh_run_mock } }))
vi.mock('#scripts/git/git-worktree', () => ({ git_worktree: { is_linked: is_linked_mock } }))
vi.mock('#scripts/lane/lane-child-marker', () => ({
	lane_child_marker: { is_child_of: is_child_mock },
}))

const { run_entry_sync } = await import('./run-entry-sync')

const OK = 0
const FAILED = 1
const MESSAGE = 'fullrun new #5747: pre-existing changes'
const ADOPT = { issue_number: '5747', command: 'fullrun', is_adopt: true }
const STASH_PUSH = 'stash:push'
const PUSH_CALL = [STASH_PUSH, MESSAGE]
const STASHED = { code: OK, out: 'stashed' }
const CLEAN = { code: OK, out: 'clean' }
const SYNCED = { code: OK, out: '' }
const BROKEN = { code: FAILED, out: '' }
const POPPED = { code: OK, out: 'popped' }

function calls(): ReadonlyArray<ReadonlyArray<string>> {
	return josh_run_mock.mock.calls.map((call) => call[0] as ReadonlyArray<string>)
}

async function report_of(): Promise<string | undefined> {
	const stop = await run_entry_sync.sync(ADOPT)

	return stop?.report
}

beforeEach(() => {
	josh_run_mock.mockReset()
	is_linked_mock.mockReset().mockResolvedValue(false)
	is_child_mock.mockReset().mockReturnValue(false)
})

describe('run_entry_sync.sync — the tree a new entry adopted is set aside, synchronized and restored', () => {
	it('stashes, runs main:sync on a primary checkout and pops the stash', async () => {
		josh_run_mock
			.mockResolvedValueOnce(STASHED)
			.mockResolvedValueOnce(SYNCED)
			.mockResolvedValueOnce(POPPED)

		expect(await run_entry_sync.sync(ADOPT)).toBeUndefined()
		expect(calls()).toStrictEqual([PUSH_CALL, ['main:sync'], ['stash:pop', MESSAGE]])
	})

	it('runs main:merge on a linked checkout, and pops nothing after a clean push', async () => {
		is_linked_mock.mockResolvedValue(true)
		josh_run_mock.mockResolvedValueOnce(CLEAN).mockResolvedValueOnce(SYNCED)

		expect(await run_entry_sync.sync({ ...ADOPT, command: 'halfrun' })).toBeUndefined()
		expect(calls()).toStrictEqual([
			[STASH_PUSH, 'halfrun new #5747: pre-existing changes'],
			['main:merge'],
		])
	})

	it.each([
		['a #N entry', { ...ADOPT, is_adopt: false }, false],
		['a lane child', ADOPT, true],
	])('runs nothing for %s', async (_label, entry, is_child) => {
		is_child_mock.mockReturnValue(is_child)

		expect(await run_entry_sync.sync(entry)).toBeUndefined()
		expect(josh_run_mock).not.toHaveBeenCalled()
	})
})

describe('run_entry_sync.sync — a failed step stops the entry with the stash kept', () => {
	it('stops on a failed sync without popping, naming the stash to pop', async () => {
		josh_run_mock.mockResolvedValueOnce(STASHED).mockResolvedValueOnce(BROKEN)

		const stop = await run_entry_sync.sync(ADOPT)

		expect(calls()).toStrictEqual([PUSH_CALL, ['main:sync']])
		expect(stop?.report).toContain(`pnpm josh stash:pop "${MESSAGE}"`)
		expect(stop?.notice.reason).toBe(run_entry_sync.SYNC_REASON)
		expect(stop?.notice.recommended).toContain(`pop the stash "${MESSAGE}"`)
		expect(stop?.notice.alternatives).toStrictEqual([
			`Leave the Issue for a later session — the stash "${MESSAGE}" is kept`,
		])
	})

	it('says nothing was stashed when a sync fails over a clean tree', async () => {
		josh_run_mock.mockResolvedValueOnce(CLEAN).mockResolvedValueOnce(BROKEN)

		const stop = await run_entry_sync.sync(ADOPT)

		expect(stop?.report).toContain('nothing was stashed')
		expect(stop?.notice.recommended).toBe('Put the tree right, then rerun the entry')
	})

	it('stops before the sync when the push fails', async () => {
		josh_run_mock.mockResolvedValueOnce(BROKEN)

		expect(await report_of()).toContain('`stash:push` failed')
		expect(calls()).toStrictEqual([PUSH_CALL])
	})
})

function pop_answers(verdict: string): void {
	josh_run_mock
		.mockResolvedValueOnce(STASHED)
		.mockResolvedValueOnce(SYNCED)
		.mockResolvedValueOnce({ code: verdict === 'conflicted' ? OK : FAILED, out: verdict })
}

describe('run_entry_sync.sync — a pop other than popped stops the entry by its verdict', () => {
	it('asks a conflicted pop to resolve the conflicts and drop the entry git kept', async () => {
		pop_answers('conflicted')

		const stop = await run_entry_sync.sync(ADOPT)

		expect(stop?.report).toContain('applied with conflicts')
		expect(stop?.notice.recommended).toContain(`drop the kept stash "${MESSAGE}"`)
	})

	it.each(['ambiguous', 'no-match'])(
		'names the kept stash after a pop answering %s',
		async (verdict) => {
			pop_answers(verdict)

			const stop = await run_entry_sync.sync(ADOPT)

			expect(stop?.report).toContain(
				`the stash "${MESSAGE}" is kept — find it with \`git stash list\``,
			)
			expect(stop?.notice.alternatives?.[0]).toContain(`the stash "${MESSAGE}" is kept`)
		},
	)
})
