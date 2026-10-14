import { git_common_directory } from '#scripts/git/git-common-directory'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { run_ship_detach } from '#scripts/run/ship/run-ship-detach'
import { describe, expect, it, vi } from 'vitest'
import { run_merge_ship } from './run-merge-ship'

// joshuafolkken/kit#3808: a child whose detached ship ended is parked for the stage the ship stopped at,
// not for the generic "session ended with its issue open".

const CHILD = '12'
const FAILED = 'failed'
const ABNORMAL = 'abnormal'
const STOP_TEXT = '#12 review failed — pnpm josh ship --log 12'
const OLD_STOP_TEXT = '#12 gate failed — pnpm josh ship --log 12'
const NO_STOP = 'before recording a stopped stage'
const WORKTREE = '/repo'
const REPOSITORY = '/repo/.git'

function event(pos: number, kind: string, text: string): RunEvent {
	return { pos, at: '2026-10-15T00:00:00.000Z', kind, text }
}

const LAUNCH = event(1, run_event_stream.EVENT_KIND.SHIP_LAUNCH, '#12 ship supervisor launched')
const STOP = event(2, run_event_stream.EVENT_KIND.SHIP_STOP, STOP_TEXT)
const OTHER_STOP = event(
	3,
	run_event_stream.EVENT_KIND.SHIP_STOP,
	'#123 push failed — pnpm josh ship --log 123',
)

type Ending = ReturnType<typeof run_ship_detach.read_result>

function ending(result: 'running' | 'success' | typeof FAILED | typeof ABNORMAL): Ending {
	return { launch_id: 'launch', result }
}

describe('run_merge_ship.cause_of', () => {
	it('names the ship-stop line written since the last launch', () => {
		const cause = run_merge_ship.cause_of(ending(FAILED), [LAUNCH, STOP, OTHER_STOP], CHILD)

		expect(cause).toBe(`its detached ship stopped and was not fixed: ${STOP_TEXT}.`)
	})

	it('reads an abnormal ending the same way — a stop the relaunched session left unfixed', () => {
		expect(run_merge_ship.cause_of(ending(ABNORMAL), [LAUNCH, STOP], CHILD)).toContain(STOP_TEXT)
	})

	it('never blames a stop from before the newest launch', () => {
		const earlier = event(0, run_event_stream.EVENT_KIND.SHIP_STOP, OLD_STOP_TEXT)
		const cause = run_merge_ship.cause_of(ending(ABNORMAL), [earlier, LAUNCH], CHILD)

		expect(cause).toBe(
			`its detached ship ended abnormal ${NO_STOP} — pnpm josh ship --log ${CHILD}.`,
		)
	})

	it('never blames a ship from an earlier dispatch of the child', () => {
		const dispatched = event(4, run_event_stream.EVENT_KIND.CHILD_LAUNCH, '#12 dispatched')

		expect(
			run_merge_ship.cause_of(ending(FAILED), [LAUNCH, STOP, dispatched], CHILD),
		).toBeUndefined()
	})

	it('ignores a stop that names another issue sharing the number prefix', () => {
		expect(run_merge_ship.cause_of(ending(FAILED), [LAUNCH, OTHER_STOP], CHILD)).toContain(NO_STOP)
	})

	it.each(['running', 'success'] as const)('leaves a %s ship to the generic cause', (result) => {
		expect(run_merge_ship.cause_of(ending(result), [LAUNCH, STOP], CHILD)).toBeUndefined()
	})

	it('leaves a child that handed nothing to a ship to the generic cause', () => {
		expect(run_merge_ship.cause_of(undefined, [LAUNCH, STOP], CHILD)).toBeUndefined()
	})
})

describe('run_merge_ship.cause', () => {
	it('reads the record and the stream of the repository the directory belongs to', () => {
		const repository = vi.spyOn(git_common_directory, 'repository').mockReturnValue(REPOSITORY)
		const record = vi.spyOn(run_ship_detach, 'read_result').mockReturnValue(ending(FAILED))

		vi.spyOn(run_event_stream, 'read_events').mockReturnValue([LAUNCH, STOP])

		expect(run_merge_ship.cause(CHILD, WORKTREE)).toContain(STOP_TEXT)
		expect(repository).toHaveBeenCalledWith(WORKTREE)
		expect(record).toHaveBeenCalledWith(REPOSITORY, CHILD)
	})

	it('answers nothing outside a git repository', () => {
		vi.spyOn(git_common_directory, 'repository').mockReturnValue(undefined)

		expect(run_merge_ship.cause(CHILD, '/nowhere')).toBeUndefined()
	})
})
