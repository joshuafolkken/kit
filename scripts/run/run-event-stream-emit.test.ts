import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

// joshuafolkken/kit#2205: the write side of the event stream. Two things are pinned — the target is
// keyed on the run's identity (the common git directory `run-carry.ts` uses, the second of the two paths
// `git_directories` prints, not the work tree's own first path), and a failing resolve is swallowed so
// the caller's work never fails because an append did.

const git_directories_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/git/git-command', () => ({
	git_command: { git_directories: git_directories_mock },
}))

const { run_event_stream_emit } = await import('./run-event-stream-emit')
const { run_event_stream } = await import('./run-event-stream')

const WORKTREE = '/repo/.git/worktrees/lane'
const REPOSITORY = '/repo/.git'
const TEMPORARY = mkdtempSync(path.join(tmpdir(), 'josh-run-event-emit-'))

beforeEach(() => {
	git_directories_mock.mockReset()
})

afterAll(() => {
	rmSync(TEMPORARY, { force: true, recursive: true })
})

describe('run_event_stream_emit.stream_target', () => {
	it('keys the stream on the common git directory, not the work tree', async () => {
		git_directories_mock.mockResolvedValue([WORKTREE, REPOSITORY])

		expect(await run_event_stream_emit.stream_target()).toBe(run_event_stream.target_of(REPOSITORY))
	})

	it('resolves undefined when there is no repository to key on', async () => {
		git_directories_mock.mockResolvedValue([WORKTREE, undefined])

		expect(await run_event_stream_emit.stream_target()).toBeUndefined()
	})
})

describe('run_event_stream_emit.emit — best-effort', () => {
	it('swallows a resolve failure rather than raising it into the caller', async () => {
		git_directories_mock.mockRejectedValue(new Error('git is gone'))

		await expect(
			run_event_stream_emit.emit(run_event_stream.EVENT_KIND.MERGE, 'x'),
		).resolves.toBeUndefined()
	})

	it('does nothing when there is no run identity', async () => {
		git_directories_mock.mockResolvedValue([WORKTREE, undefined])

		await expect(
			run_event_stream_emit.emit(run_event_stream.EVENT_KIND.STOP, 'x'),
		).resolves.toBeUndefined()
	})
})
