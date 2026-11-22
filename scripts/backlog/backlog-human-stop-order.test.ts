import type { BusyRead } from '#scripts/epic/epic-busy'
import type { EpicChild } from '#scripts/epic/epic-graph'
import { describe, expect, it } from 'vitest'
import { backlog_fixture } from './backlog-fixture'
import { backlog_human_stop_order } from './backlog-human-stop-order'
import { backlog_overlap } from './backlog-overlap'

// joshuafolkken/kit#8574: a candidate that stops for a person before its merge goes behind the
// self-completing candidate whose paths overlap it, so the overlap split offers the latter.

const { REPO } = backlog_fixture
const HUMAN = 8501
const AUTO = 8502
const OTHER = 8503
const LATER = 8504
const RUNNING = 8505
const HUMAN_BODY = '## 背景\n\n- 人の判断: 要（マージ前の目視確認）\n'
const AUTO_BODY = '## 背景\n\n- 人の判断: 不要\n'
const SHARED = 'scripts/run/ship/run-ship.ts'
const HELD = 'scripts/run/ship/run-ship-steps.ts'
const IDLE: BusyRead = { kind: 'idle' }

function child(number: number, body?: string): EpicChild {
	return { number, repo: REPO, state: 'OPEN', labels: [], blocked_by: [], body }
}

// `HUMAN` and `AUTO` overlap each other; `OTHER` overlaps nobody.
function is_pair(left: EpicChild, right: EpicChild): boolean {
	return left.number !== OTHER && right.number !== OTHER && left.number !== right.number
}

function order_of(children: ReadonlyArray<EpicChild>): Array<number> {
	return backlog_human_stop_order.ordered(children, is_pair).map((entry) => entry.number)
}

describe('backlog_human_stop_order.ordered', () => {
	it('moves the overlapping self-completing candidate up into the human-stop slot', () => {
		const order = order_of([child(HUMAN, HUMAN_BODY), child(OTHER), child(AUTO, AUTO_BODY)])

		expect(order).toStrictEqual([AUTO, HUMAN, OTHER])
	})

	it('moves up only the first of two overlapping self-completing candidates', () => {
		const children = [child(HUMAN, HUMAN_BODY), child(OTHER), child(AUTO), child(LATER)]

		expect(order_of(children)).toStrictEqual([AUTO, HUMAN, OTHER, LATER])
	})

	it('keeps a human-stop candidate already behind the self-completing one', () => {
		const order = order_of([child(AUTO, AUTO_BODY), child(HUMAN, HUMAN_BODY), child(OTHER)])

		expect(order).toStrictEqual([AUTO, HUMAN, OTHER])
	})

	it('keeps the order when both candidates sit on the same side', () => {
		expect(order_of([child(HUMAN, HUMAN_BODY), child(AUTO, HUMAN_BODY)])).toStrictEqual([
			HUMAN,
			AUTO,
		])
		expect(order_of([child(AUTO, AUTO_BODY), child(HUMAN, AUTO_BODY)])).toStrictEqual([AUTO, HUMAN])
	})

	it('keeps a human-stop candidate that overlaps nobody in place', () => {
		expect(order_of([child(OTHER, HUMAN_BODY), child(AUTO, AUTO_BODY)])).toStrictEqual([
			OTHER,
			AUTO,
		])
	})

	it('reads a candidate without a body as self-completing', () => {
		expect(order_of([child(HUMAN, HUMAN_BODY), child(AUTO)])).toStrictEqual([AUTO, HUMAN])
		expect(order_of([child(HUMAN), child(AUTO)])).toStrictEqual([HUMAN, AUTO])
	})
})

describe('backlog_overlap.separate with a human-stop candidate', () => {
	it.each([[[HUMAN, AUTO]], [[AUTO, HUMAN]]])('offers the self-completing one from %j', (order) => {
		const bodies = new Map([
			[HUMAN, `${HUMAN_BODY}- \`${SHARED}\` を直す\n`],
			[AUTO, `${AUTO_BODY}- \`${SHARED}\` を直す\n`],
		])
		const offered = order.map((number) => child(number, bodies.get(number)))
		const declared = backlog_overlap.declared_of(offered)
		const selection = backlog_overlap.separate({ offered, withheld: [] }, declared, {
			read: IDLE,
			repo: REPO,
		})

		expect(selection.offered.map((entry) => entry.number)).toStrictEqual([AUTO])
		expect(selection.withheld.map((entry) => entry.number)).toStrictEqual([HUMAN])
	})

	it('offers the human-stop one in its slot when a running lane withholds the other', () => {
		const offered = [
			child(HUMAN, `${HUMAN_BODY}- \`${SHARED}\` を直す\n`),
			child(OTHER),
			child(AUTO, `${AUTO_BODY}- \`${SHARED}\` と \`${HELD}\` を直す\n`),
		]
		const running = { number: RUNNING, body: `- \`${HELD}\` を直す` }
		const declared = backlog_overlap.declared_of([...offered, running])
		const read: BusyRead = {
			kind: 'busy',
			issues: [{ number: RUNNING, title: 'running', createdAt: '2026-11-22T00:00:00Z' }],
		}
		const selection = backlog_overlap.separate({ offered, withheld: [] }, declared, {
			read,
			repo: REPO,
		})

		expect(selection.offered.map((entry) => entry.number)).toStrictEqual([HUMAN, OTHER])
		expect(selection.withheld.map((entry) => entry.number)).toStrictEqual([AUTO])
	})
})
