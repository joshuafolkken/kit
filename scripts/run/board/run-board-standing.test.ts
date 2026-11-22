import { stripVTControlCharacters } from 'node:util'
import { MS_PER_MINUTE } from '#scripts/lib/timeouts'
import { describe, expect, it } from 'vitest'
import { run_board_standing, type StandingHeader } from './run-board-standing'

// joshuafolkken/kit#8475: what holds over frames is said in the header's notice slot, one state at a
// time, and a failed read's reason is written as a finding.

const { notes_of, slot_of } = run_board_standing

const NOW = 100 * MS_PER_MINUTE
const SECOND_MS = 1000
// The heartbeat is missed past half again the `run:progress` interval, read once per process — 22.5′
// at this repository's 15′, 30′ at the 20′ default — so the ages either side hold under both.
const MINUTES = { recent: 1, before_retry: 4, past_retry: 6, before_gap: 20, past_gap: 31 }
const RETRYING_1 = '❗ stale 1′00″ · retrying'
const LOGIN = 'gh auth login'
const NOT_FOUND = 'gh not found'
const SAYS_RETRYING = '· retrying'

function ago(minutes: number): number {
	return NOW - minutes * MS_PER_MINUTE
}

function header_of(fields: Partial<StandingHeader> = {}): StandingHeader {
	const activity = { last_event_ms: ago(MINUTES.recent), outage: undefined, is_stopped: false }

	return { now_ms: NOW, ended_ms: undefined, activity, ...fields }
}

// The slot's words without their color, or undefined while nothing holds.
function words(fields: Partial<StandingHeader>): string | undefined {
	const slot = slot_of(header_of(fields))

	return slot === undefined ? undefined : stripVTControlCharacters(slot[0])
}

function silent(minutes: number): Partial<StandingHeader> {
	return { activity: { last_event_ms: ago(minutes), outage: undefined, is_stopped: false } }
}

const OFFLINE = {
	activity: {
		last_event_ms: ago(MINUTES.past_gap),
		outage: { from_ms: ago(MINUTES.past_retry), down_ms: NOW - SECOND_MS },
		is_stopped: false,
	},
}

function board_failed(reason: string, minutes: number = MINUTES.recent): Partial<StandingHeader> {
	return { read_failed_ms: ago(minutes), read_error: reason }
}

describe('run_board_standing.slot_of, one state at a time', () => {
	it('says nothing while nothing holds', () => {
		expect(slot_of(header_of())).toBeUndefined()
	})

	it('says the network down, for how long, over a failed read and a quiet heartbeat', () => {
		expect(words({ ...OFFLINE, ...board_failed('boom') })).toBe('📴 6′00″')
	})

	it('says a failed read over a quiet heartbeat', () => {
		expect(words({ ...silent(MINUTES.past_gap), ...board_failed('boom') })).toBe(RETRYING_1)
	})

	it('says the board read before the plan, the plan stale since it last landed', () => {
		const plan = { plan_fetched_ms: ago(MINUTES.past_retry), plan_failed_ms: ago(MINUTES.recent) }

		expect(words(plan)).toBe('❗ stale 6′00″ · retrying')
		expect(words({ ...plan, ...board_failed('ETIMEDOUT') })).toBe(RETRYING_1)
	})

	it('types a state by its words, not by its age', () => {
		const early = slot_of(header_of(board_failed('boom', MINUTES.recent)))
		const later = slot_of(header_of(board_failed('boom', MINUTES.before_retry)))

		expect(early?.[1]).toBe(later?.[1])
		expect(early?.[0]).not.toBe(later?.[0])
	})
})

describe('run_board_standing.slot_of, what a failure asks of a person', () => {
	it.each([
		['gh: not logged in to any hosts', LOGIN],
		['HTTP 401: Bad credentials', LOGIN],
		['spawn gh ENOENT', NOT_FOUND],
		['gh CLI is not installed. Install it from https://cli.github.com/', NOT_FOUND],
		['connect ETIMEDOUT 140.82.112.6:443', 'retrying'],
		['HTTP 502: Bad Gateway', 'retrying'],
	])('says %s as %s', (reason, action) => {
		expect(words(board_failed(reason, MINUTES.past_retry))).toContain(`· ${action}`)
	})

	it('retries an unknown reason a while, then points at the findings', () => {
		expect(words(board_failed('boom', MINUTES.before_retry))).toContain(SAYS_RETRYING)
		expect(words(board_failed('boom', MINUTES.past_retry))).toContain('· see findings')
	})

	it('keeps retrying a failure with no reason, which writes no finding', () => {
		expect(words({ read_failed_ms: ago(MINUTES.past_retry) })).toContain(SAYS_RETRYING)
		expect(words(board_failed('', MINUTES.past_retry))).toContain(SAYS_RETRYING)
	})
})

describe('run_board_standing.slot_of, the heartbeat', () => {
	it('says the heartbeat missed past half again the progress interval', () => {
		expect(words(silent(MINUTES.past_gap))).toBe('❗ no heartbeat 31′')
		expect(words(silent(MINUTES.before_gap))).toBeUndefined()
	})

	it('keeps no heartbeat for a stopped or ended run', () => {
		const stopped = { last_event_ms: ago(MINUTES.past_gap), outage: undefined, is_stopped: true }

		expect(words({ activity: stopped })).toBeUndefined()
		expect(words({ ...silent(MINUTES.past_gap), ended_ms: ago(MINUTES.recent) })).toBeUndefined()
	})
})

describe('run_board_standing.notes_of', () => {
	it('writes each failed read’s reason as a finding at the moment it failed', () => {
		const at_ms = ago(MINUTES.recent)
		const plan = { plan_failed_ms: at_ms, plan_error: 'gh: not logged in' }
		const note = { kind: 'note', at_ms, issue: undefined }

		const header = header_of({ ...board_failed('exit 1'), ...plan })

		expect(notes_of(header)).toStrictEqual([
			{ ...note, text: 'board read failed: exit 1' },
			{ ...note, text: 'plan read failed: gh: not logged in' },
		])
	})

	it('writes none for a failure with no reason', () => {
		const header = header_of({ read_failed_ms: ago(MINUTES.recent) })

		expect(notes_of(header)).toStrictEqual([])
	})
})
