import { describe, expect, it } from 'vitest'
import { backlog_drive } from './backlog-drive'
import { backlog_drive_fixture } from './backlog-drive-fixture'

// A `stop` from `run:merge` is the offer's `stop` reached through a merge: the child is collected,
// nothing more starts, and the children still in flight are collected before the loop ends
// (joshuafolkken/kit#2881).

const { CONFIG, FIRST_CHILD, OFFERED, SECOND_CHILD } = backlog_drive_fixture
const { harness, offer, state } = backlog_drive_fixture
const STOP = 'stop'

describe('backlog_drive.run_pass — a merge that answers stop', () => {
	it('collects the child and keeps the run going for the one still in flight', async () => {
		const { ports, calls } = harness({
			finished: [FIRST_CHILD],
			merges: new Map([[FIRST_CHILD, STOP]]),
		})
		const result = await backlog_drive.run_pass(state([FIRST_CHILD, SECOND_CHILD]), true, ports)

		expect(calls).toStrictEqual([`merge ${FIRST_CHILD}`])
		expect(result.kind).toBe('continue')
		expect(result.state.is_stopping).toBe(true)
		expect(result.state.in_flight).toStrictEqual([SECOND_CHILD])
		expect(result.state.exclude).toStrictEqual([FIRST_CHILD])
		expect(result.state.stopped_by).toBe(FIRST_CHILD)
	})

	it('starts nothing new after a hand-back resumes the stop it carried', async () => {
		const { ports, calls } = harness({ offers: [offer('run', [OFFERED])] })
		const resumed = backlog_drive.merge_stopped(FIRST_CHILD, state([SECOND_CHILD]))
		const result = await backlog_drive.run_pass(resumed, true, ports)

		expect(calls).toStrictEqual([])
		expect(result.state.is_stopping).toBe(true)
	})

	it('ends as stop at once when the stopping child was the last in flight', async () => {
		const { ports } = harness({ finished: [FIRST_CHILD], merges: new Map([[FIRST_CHILD, STOP]]) })
		const result = await backlog_drive.run_pass(state([FIRST_CHILD]), true, ports)

		expect(result.kind === 'end' && result.end.reason).toBe(STOP)
		expect(result.kind === 'end' && result.end.detail).toContain(`#${FIRST_CHILD}`)
	})

	it('keeps the reason of a stop an offer already gave', async () => {
		const { ports } = harness({ finished: [FIRST_CHILD], merges: new Map([[FIRST_CHILD, STOP]]) })
		const stopping = { ...state([FIRST_CHILD]), is_stopping: true, stop_reason: 'budget' }
		const result = await backlog_drive.run_pass(stopping, true, ports)

		expect(result.kind === 'end' && result.end.detail).toBe('budget')
	})
})

describe('backlog_drive.run_loop — a merge that answers stop', () => {
	it('waits for the child still in flight, starts nothing new, then finishes', async () => {
		const { ports, calls, states } = harness({
			finished: [FIRST_CHILD, SECOND_CHILD],
			merges: new Map([[FIRST_CHILD, STOP]]),
			offers: [offer('run', [OFFERED])],
		})
		const end = await backlog_drive.run_loop(state([FIRST_CHILD, SECOND_CHILD]), CONFIG, ports)

		expect(calls).toStrictEqual([`merge ${FIRST_CHILD}`, `merge ${SECOND_CHILD}`, 'finish'])
		expect(end.reason).toBe(STOP)
		expect(states.at(-1)?.exclude).toStrictEqual([FIRST_CHILD, SECOND_CHILD])
	})
})

describe('backlog_drive.run_loop — the children a merge stop waits on', () => {
	it('collects a child that finishes on a later pass before finishing', async () => {
		const { ports, calls } = harness({
			finished: [FIRST_CHILD],
			merges: new Map([[FIRST_CHILD, STOP]]),
		})
		let passes = 0
		const { is_finished } = ports

		ports.is_finished = (issue: string): boolean => {
			if (issue === SECOND_CHILD) passes += 1

			return issue === SECOND_CHILD ? passes > 1 : is_finished(issue)
		}

		const end = await backlog_drive.run_loop(state([FIRST_CHILD, SECOND_CHILD]), CONFIG, ports)

		expect(calls).toStrictEqual([`merge ${FIRST_CHILD}`, `merge ${SECOND_CHILD}`, 'finish'])
		expect(end.reason).toBe(STOP)
	})

	it('still hands over back at once while a stop is collecting', async () => {
		const { ports, calls } = harness({
			finished: [FIRST_CHILD, SECOND_CHILD],
			merges: new Map([
				[FIRST_CHILD, STOP],
				[SECOND_CHILD, 'over'],
			]),
		})
		const end = await backlog_drive.run_loop(state([FIRST_CHILD, SECOND_CHILD]), CONFIG, ports)

		expect(calls).not.toContain('finish')
		expect(end).toStrictEqual({ reason: 'merge', token: 'over', issue: SECOND_CHILD })
	})
})
