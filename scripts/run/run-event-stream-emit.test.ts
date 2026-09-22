import { randomUUID } from 'node:crypto'
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

// joshuafolkken/kit#2335: `emit_once` writes a marker a watching loop re-checks every poll a single time
// per episode — the drain marker `backlog:offer` emits so `run:step` fires the retrospective once.
const { DRAIN } = run_event_stream.EVENT_KIND
const DRAIN_TEXT = 'backlog drained'

// A fresh repository string per test so its stamp path is its own file; a UUID rather than a shared
// counter keeps `fresh_repository` from assigning a top-level variable.
function fresh_repository(): string {
	return path.join(TEMPORARY, `${randomUUID()}.git`)
}

async function drain_events(): Promise<ReadonlyArray<{ kind: string }>> {
	const target = await run_event_stream_emit.stream_target()

	if (target === undefined) throw new Error('no stream target resolved')

	const events = run_event_stream.read_events(target)

	rmSync(target, { force: true })

	return events.filter((event) => event.kind === DRAIN)
}

describe('run_event_stream_emit.emit_once — one marker per episode', () => {
	it('appends the first time, then skips while it is still the newest event', async () => {
		git_directories_mock.mockResolvedValue([WORKTREE, fresh_repository()])

		await run_event_stream_emit.emit_once(DRAIN, DRAIN_TEXT)
		await run_event_stream_emit.emit_once(DRAIN, DRAIN_TEXT)

		expect(await drain_events()).toHaveLength(1)
	})

	it('appends again once a different event has intervened', async () => {
		git_directories_mock.mockResolvedValue([WORKTREE, fresh_repository()])

		await run_event_stream_emit.emit_once(DRAIN, DRAIN_TEXT)
		await run_event_stream_emit.emit(run_event_stream.EVENT_KIND.MERGE, '#7 merged')
		await run_event_stream_emit.emit_once(DRAIN, DRAIN_TEXT)

		expect(await drain_events()).toHaveLength(2)
	})
})
