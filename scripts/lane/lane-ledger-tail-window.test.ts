import { appendFileSync } from 'node:fs'
import path from 'node:path'
import { json_value } from '#scripts/lib/json-value'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { lane_ledger_tail } from './lane-ledger-tail'

// joshuafolkken/kit#8206: a window grown by its appends holds what a backward read of the whole
// window gives, and lets go of the lines its start moved past.

const make_directory = temporary_directory('suite')
const scratch = make_directory('lane-ledger-tail-window-test-')
const START_MS = Date.parse('2026-10-01T00:00:00.000Z')
const HOUR = 3_600_000
const HOURS = 6

function merge_at(hour: number): object {
	return { kind: 'merge', at: new Date(START_MS + hour * HOUR).toISOString(), issue: hour }
}

function line_of(hour: number): string {
	return `${JSON.stringify(merge_at(hour))}\n`
}

function hours_ledger(name: string, hours: number): string {
	const target = path.join(scratch, `${name}.jsonl`)

	for (let hour = 0; hour < hours; hour += 1) appendFileSync(target, line_of(hour))

	return target
}

function since(hour: number): number {
	return START_MS + hour * HOUR
}

function keep_all(): boolean {
	return true
}

function sliding(): ReturnType<typeof lane_ledger_tail.window_store> {
	return lane_ledger_tail.window_store(keep_all, { slides: true })
}

describe('lane_ledger_tail.window_store against a whole backward read', () => {
	it('holds what read_since gives before and after each append as its start moves on', () => {
		const target = hours_ledger('window-equal', HOURS)
		const store = sliding()

		for (let hour = 0; hour < HOURS; hour += 1) {
			const start = since(hour)

			expect(store.read(target, start)).toStrictEqual(
				lane_ledger_tail.read_since(target, start).entries,
			)
			appendFileSync(target, line_of(HOURS + hour))

			expect(store.read(target, start)).toStrictEqual(
				lane_ledger_tail.read_since(target, start).entries,
			)
		}
	})
})

describe('lane_ledger_tail.window_store letting go of older lines', () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('reads backward again for a start its moved-on window let go of', () => {
		const target = hours_ledger('window-prune', HOURS)
		const store = sliding()

		store.read(target, since(0))
		appendFileSync(target, line_of(HOURS))
		store.read(target, since(2))
		const parse = vi.spyOn(json_value, 'parse_or_undefined')

		expect(store.read(target, since(1))).toStrictEqual(
			lane_ledger_tail.read_since(target, since(1)).entries,
		)
		expect(parse.mock.calls.map(([line]) => line)).toContain(JSON.stringify(merge_at(1)))
	})

	it('keeps the lines while its start moved on by less than the step', () => {
		const target = hours_ledger('window-keep', HOURS)
		const store = sliding()

		store.read(target, since(0))
		appendFileSync(target, line_of(HOURS))
		store.read(target, since(0) + HOUR / 2)
		const parse = vi.spyOn(json_value, 'parse_or_undefined')

		expect(store.read(target, since(0))).toHaveLength(HOURS + 1)
		expect(parse).not.toHaveBeenCalled()
	})
})

describe('lane_ledger_tail.window_store not sliding', () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('keeps the whole window for a reader of several starts', () => {
		const target = hours_ledger('window-fixed', HOURS)
		const store = lane_ledger_tail.window_store()

		store.read(target, since(0))
		store.read(target, since(HOURS - 1))
		const parse = vi.spyOn(json_value, 'parse_or_undefined')

		expect(store.read(target, since(0))).toHaveLength(HOURS)
		expect(parse).not.toHaveBeenCalled()
	})
})
