import { stamp_file } from '#scripts/josh/stamp-file'
import { figure_format } from '#scripts/lib/figure-format'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { lane_state, type LaneChange } from './lane-state'
import { lane_state_event } from './lane-state-event'
import { lane_state_record, type LaneStateRecord } from './lane-state-record'

// joshuafolkken/kit#8775: every lane-state write is an event of the lifecycle table.

const make_directory = temporary_directory()

const ISSUE = '8775'
const AT = new Date('2026-11-23T01:00:00.000Z')
const OPEN = 'lane:open'
const PAUSE = 'lane:pause'
const DISPATCH = 'lane:dispatch'
const RESUME = 'lane:resume'
const DEPENDENCY_WAIT = 'lane:dependency-wait'
const PERSON = 'person'
const BY_WAIT = 'dependency-wait'

const state = { directory: '' }

function change_of(to: LaneChange['state'], command: string, is_launch?: boolean): LaneChange {
	return { issue: ISSUE, state: to, command, ...(is_launch !== undefined && { is_launch }) }
}

async function record(change: LaneChange): ReturnType<typeof lane_state.record_change> {
	return await lane_state.record_change(change, { directory: state.directory, now: AT })
}

async function current(): Promise<LaneStateRecord | undefined> {
	return await lane_state.read_state(ISSUE, state.directory)
}

// A record as a writer before `paused_by` existed left it.
function write_legacy(changed_by: string): void {
	const legacy = { issue: ISSUE, state: 'paused', changed_at: AT.toISOString(), changed_by }

	stamp_file.replace_stamp(lane_state.state_path(state.directory, ISSUE), legacy)
}

beforeEach(() => {
	state.directory = make_directory('lane-state-event-')
	vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
	stamp_file.remove_stamp(lane_state.state_path(state.directory, ISSUE))
	vi.restoreAllMocks()
})

describe('lane_state_event.judge — the event a write is', () => {
	it.each([
		['open', 'launch'],
		['running', 'restart'],
		['human-review', 'review-resume'],
	] as const)('takes a launch from %s as %s', (from, event) => {
		const verdict = lane_state_event.judge(change_of('running', DISPATCH, true), {
			state: from,
			paused_by: undefined,
		})

		expect(verdict).toMatchObject({ kind: 'allowed', event })
	})

	it.each([
		['a launch into a paused lane', change_of('running', DISPATCH, true), BY_WAIT],
		['a dependency release of a person’s pause', change_of('running', DISPATCH), PERSON],
		['a person’s resume of a dependency wait', change_of('running', RESUME), BY_WAIT],
		['a dependency wait over a person’s pause', change_of('paused', DEPENDENCY_WAIT), PERSON],
	] as const)('rejects %s', (_name, change, paused_by) => {
		const verdict = lane_state_event.judge(change, { state: 'paused', paused_by })

		expect(verdict.kind).toBe('rejected')
	})

	it('rejects a command no event names, and a state its event does not reach', () => {
		expect(lane_state_event.judge(change_of('paused', 'lane:nap'))).toMatchObject({
			kind: 'rejected',
			reason: 'no event for lane:nap',
		})
		expect(lane_state_event.judge(change_of('running', PAUSE)).kind).toBe('rejected')
	})

	it('lets a lane with no record take any event reaching the state asked for', () => {
		expect(lane_state_event.judge(change_of('running', DISPATCH))).toMatchObject({
			kind: 'allowed',
			event: 'dependency-resume',
		})
	})
})

describe('lane_state.record_change — who paused the lane', () => {
	it('keeps the dependency wait through a launch until dispatch releases it', async () => {
		await record(change_of('open', OPEN))
		await record(change_of('paused', DEPENDENCY_WAIT))
		const refused = await record(change_of('running', DISPATCH, true))

		expect(refused.kind).toBe('rejected')
		expect(await current()).toMatchObject({ state: 'paused', paused_by: BY_WAIT })
		await record(change_of('running', DISPATCH))
		await record(change_of('running', DISPATCH, true))
		expect(await current()).toMatchObject({ state: 'running' })
		expect(await current()).not.toHaveProperty('paused_by')
	})

	it('leaves a person’s pause over a dependency wait to the person', async () => {
		await record(change_of('paused', DEPENDENCY_WAIT))
		await record(change_of('paused', PAUSE))
		const released = await record(change_of('running', DISPATCH))

		expect(released.kind).toBe('rejected')
		expect(await current()).toMatchObject({ state: 'paused', paused_by: PERSON })
		await expect(record(change_of('running', RESUME))).resolves.toMatchObject({ kind: 'written' })
	})

	it.each([
		[DEPENDENCY_WAIT, BY_WAIT],
		[PAUSE, PERSON],
	])('reads a record from before paused_by by its changed_by %s', async (changed_by, origin) => {
		write_legacy(changed_by)
		const legacy = await current()
		const since = figure_format.minute_of(AT.getTime())

		expect(lane_state_record.pause_origin(legacy)).toBe(origin)
		expect(lane_state.paused_note(legacy)).toBe(`paused since ${since} by ${changed_by}`)
	})
})
