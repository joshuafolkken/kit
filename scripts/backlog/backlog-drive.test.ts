import type { RunEvent } from '#scripts/run/run-event-stream'
import { describe, expect, it } from 'vitest'
import { backlog_drive } from './backlog-drive'

// joshuafolkken/kit#2508: the pure transitions of `backlog:drive` — what a restart restores from the
// open lanes and the event stream, and which `run:merge` answer is a judgement branch.

const NOW = 1000
const LAUNCH = 'child-launch'
const ELEVEN = '11'
const ELEVEN_LAUNCHED = '#11 dispatched'
const AT = '2026-09-24T00:00:00.000Z'

function event(kind: string, text: string): RunEvent {
	return { pos: 0, at: AT, kind, text }
}

describe('backlog_drive.restore — a restart reads, never remembers', () => {
	it('keeps an open lane running while its newest event is a launch', () => {
		const state = backlog_drive.restore([ELEVEN], [event(LAUNCH, ELEVEN_LAUNCHED)], NOW)

		expect(state.running).toStrictEqual([ELEVEN])
		expect(state.active_at_ms).toBe(NOW)
	})

	it('treats an open lane whose newest event is a merge or a park as settled', () => {
		const events = [
			event(LAUNCH, ELEVEN_LAUNCHED),
			event('merge', '#11 merged'),
			event(LAUNCH, '#12 dispatched'),
			event('park', '#12 parked'),
		]
		const state = backlog_drive.restore([ELEVEN, '12'], events, NOW)

		expect(state.running).toStrictEqual([])
		expect(state.excludes).toStrictEqual([ELEVEN])
	})

	it('reads a child launched again after an outage as running', () => {
		const events = [
			event('outage', '#13 outage (re-dispatchable)'),
			event(LAUNCH, '#13 dispatched'),
		]

		expect(backlog_drive.restore(['13'], events, NOW).running).toStrictEqual(['13'])
	})

	it('ignores events that name no issue or are not launch-or-settle kinds', () => {
		const events = [event('drain', 'backlog drained'), event('heartbeat', '#14 at gate')]

		expect(backlog_drive.restore(['14'], events, NOW).running).toStrictEqual(['14'])
	})
})

describe('backlog_drive.settle_of — which run:merge answer needs a judgement', () => {
	it('continues past a merged child that offered the next', () => {
		expect(backlog_drive.settle_of('7', { outcome: 'merged', token: '8' })).toStrictEqual({
			kind: 'next',
			outcome: 'merged',
		})
	})

	it('stops on a control token with the child named', () => {
		const settled = backlog_drive.settle_of('7', { outcome: 'merged', token: 'over' })

		expect(settled).toStrictEqual({
			kind: 'stop',
			stop: { verdict: 'over', issue: '7', detail: undefined },
		})
	})

	it('stops on a parked or failed child even though its token is the next offer', () => {
		expect(backlog_drive.settle_of('7', { outcome: 'parked', token: '8' })).toMatchObject({
			stop: { verdict: 'park' },
		})
		expect(backlog_drive.settle_of('7', { outcome: 'failed', token: '8' })).toMatchObject({
			stop: { verdict: 'failed' },
		})
	})

	it('awaits a resumed child again and re-reads an unresolved one', () => {
		expect(backlog_drive.settle_of('7', { outcome: 'cut', token: 'resumed' }).kind).toBe('again')
		expect(backlog_drive.settle_of('7', { outcome: 'unresolved', token: 'retry' }).kind).toBe(
			'retry',
		)
	})
})

describe('backlog_drive.line_of — the one line a caller branches on', () => {
	it('joins the verdict, the issue and the detail that are present', () => {
		expect(backlog_drive.line_of({ verdict: 'park', issue: '7', detail: undefined })).toBe(
			'park #7',
		)
		expect(backlog_drive.line_of({ verdict: 'done', issue: undefined, detail: 'empty' })).toBe(
			'done empty',
		)
	})
})
