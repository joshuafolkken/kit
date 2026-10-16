import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { run_hold, type RunHold } from './run-hold'
import { run_hold_session } from './run-hold-session'

// joshuafolkken/kit#3961: the Stop hook announces only this session's own pause, and only once.

const scratch = mkdtempSync(path.join(tmpdir(), 'run-hold-session-test-'))
const TARGET = path.join(scratch, 'hold.json')
const TAKEN_AT = '2026-10-01T00:00:00.000Z'
const BEFORE = '2026-10-01T00:01:00.000Z'
const NOTIFIED_AT = '2026-10-01T00:02:00.000Z'
const AFTER = '2026-10-01T00:03:00.000Z'
const OWN_PID = 4242
const OTHER_PID = 4343
const OWN_START = 'Thu Oct  1 00:00:00 2026'
const HOLD: RunHold = { issue: '7', taken_at: TAKEN_AT, pid: OWN_PID }
const OWN = { owner_pid: OWN_PID, owner_start: OWN_START }

afterAll(() => {
	rmSync(scratch, { force: true, recursive: true })
})

describe('run_hold_session.is_session_hold', () => {
	it.each([
		['the hold records no owner', HOLD, OWN],
		['the session reads no owner', { ...HOLD, ...OWN }, {}],
		['the same process holds it', { ...HOLD, ...OWN }, OWN],
		['the hold records no start', { ...HOLD, owner_pid: OWN_PID }, OWN],
	])('reads it as this session’s own when %s', (_label, hold, owner) => {
		expect(run_hold_session.is_session_hold(hold, owner)).toBe(true)
	})

	it.each([
		['another process holds it', { ...HOLD, ...OWN, owner_pid: OTHER_PID }],
		['a reused pid started later', { ...HOLD, ...OWN, owner_start: 'Fri Oct  2 00:00:00 2026' }],
	])('reads it as another run’s when %s', (_label, hold) => {
		expect(run_hold_session.is_session_hold(hold, OWN)).toBe(false)
	})
})

describe('run_hold_session.is_notified_since', () => {
	it('is not notified when the hold records no send', () => {
		expect(run_hold_session.is_notified_since(HOLD, BEFORE)).toBe(false)
	})

	it('announces again when the pause start is unknown', () => {
		const hold = { ...HOLD, notified_at: NOTIFIED_AT }

		expect(run_hold_session.is_notified_since(hold, undefined)).toBe(false)
	})

	it.each([
		[BEFORE, true],
		[AFTER, false],
	])('compares the send with a prompt at %s', (prompt_time, expected) => {
		const hold = { ...HOLD, notified_at: NOTIFIED_AT }

		expect(run_hold_session.is_notified_since(hold, prompt_time)).toBe(expected)
	})
})

describe('run_hold_session.mark_notified', () => {
	it('stamps the send on a held record', () => {
		const now = new Date(NOTIFIED_AT)

		run_hold.write_hold(TARGET, '7', now)
		run_hold_session.mark_notified(TARGET, now)

		const read = run_hold.read_hold(TARGET, now)

		expect(read.kind === 'held' ? read.hold.notified_at : undefined).toBe(NOTIFIED_AT)
	})

	it('stamps the send on a record past the expiry age', () => {
		const now = new Date(Date.parse(TAKEN_AT) + run_hold.HOLD_MAX_AGE_MS + 1)

		run_hold.write_hold(TARGET, '7', new Date(TAKEN_AT))
		run_hold_session.mark_notified(TARGET, now)

		expect(run_hold.read_hold(TARGET, now)).toMatchObject({
			kind: 'stale',
			hold: { notified_at: now.toISOString() },
		})
	})

	it('writes nothing on a free tree', () => {
		const free = path.join(scratch, 'free.json')

		run_hold_session.mark_notified(free)

		expect(run_hold.read_hold(free).kind).toBe('free')
	})
})
