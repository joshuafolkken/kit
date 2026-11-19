import { appendFileSync, renameSync } from 'node:fs'
import path from 'node:path'
import { json_value } from '#scripts/lib/json-value'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { lane_ledger_tail } from './lane-ledger-tail'
import { lane_ledger_write } from './lane-ledger-write'

const make_directory = temporary_directory('suite')

// joshuafolkken/kit#7012: an appended ledger is parsed only past the lines already parsed, and a
// replaced one is read again whole.

const scratch = make_directory('lane-ledger-tail-test-')
const AT = '2026-10-06T00:00:00.000Z'

function ledger(name: string): string {
	return path.join(scratch, `${name}.jsonl`)
}

function merge(issue: number): object {
	return { kind: 'merge', at: AT, issue }
}

describe('lane_ledger_tail.read on an appended ledger', () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('parses only the lines appended since the last read', () => {
		const target = ledger('append')

		lane_ledger_write.append(target, merge(1))
		lane_ledger_write.append(target, merge(2))
		lane_ledger_tail.read(target)
		const parse = vi.spyOn(json_value, 'parse_or_undefined')

		lane_ledger_write.append(target, merge(3))

		expect(lane_ledger_tail.read(target)).toStrictEqual([merge(1), merge(2), merge(3)])
		expect(parse.mock.calls.map(([line]) => line).filter(Boolean)).toStrictEqual([
			JSON.stringify(merge(3)),
		])
	})

	it('hands back the same entries while the file is unchanged', () => {
		const target = ledger('unchanged')

		lane_ledger_write.append(target, merge(1))

		expect(lane_ledger_tail.read(target)).toBe(lane_ledger_tail.read(target))
	})
})

describe('lane_ledger_tail.read on a replaced ledger', () => {
	it('reads it again whole', () => {
		const target = ledger('replaced')
		const replacement = ledger('replacement')

		lane_ledger_write.append(target, merge(1))
		lane_ledger_tail.read(target)
		lane_ledger_write.append(replacement, merge(7))
		lane_ledger_write.append(replacement, merge(8))
		renameSync(replacement, target)

		expect(lane_ledger_tail.read(target)).toStrictEqual([merge(7), merge(8)])
	})

	it('reads a removed ledger as empty', () => {
		const target = ledger('removed')

		lane_ledger_write.append(target, merge(1))
		lane_ledger_tail.read(target)
		renameSync(target, ledger('removed-aside'))

		expect(lane_ledger_tail.read(target)).toStrictEqual([])
	})
})

// joshuafolkken/kit#7930: the recent window read backward from the end.

const DAYS = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']
const SMALL_CHUNK_BYTES = 16

function merge_on(day_index: number): object {
	return { kind: 'merge', at: `${DAYS[day_index] ?? ''}T00:00:00.000Z`, issue: day_index }
}

function since(day_index: number): number {
	return Date.parse(`${DAYS[day_index] ?? ''}T00:00:00.000Z`)
}

function ledger_of(name: string, lines: ReadonlyArray<string>): string {
	const target = ledger(name)

	appendFileSync(target, lines.join('\n'))

	return target
}

function days_ledger(name: string): string {
	return ledger_of(name, [...DAYS.map((_, index) => JSON.stringify(merge_on(index))), ''])
}

describe('lane_ledger_tail.read_since on the window', () => {
	it('returns only the window, oldest first, without reaching the start', () => {
		expect(lane_ledger_tail.read_since(days_ledger('window'), since(2))).toStrictEqual({
			entries: [merge_on(2), merge_on(3)],
			reached_start: false,
		})
	})

	it('reaches the start when every line is in the window', () => {
		expect(lane_ledger_tail.read_since(days_ledger('all'), since(0))).toStrictEqual({
			entries: [merge_on(0), merge_on(1), merge_on(2), merge_on(3)],
			reached_start: true,
		})
	})

	it('reads past a backdated line to the window lines written before it', () => {
		const backdated = { kind: 'merge', at: '2026-10-02T23:50:00.000Z', issue: 9 }
		const lines = [merge_on(0), merge_on(2), backdated, merge_on(3)].map((line) =>
			JSON.stringify(line),
		)
		const target = ledger_of('backdated', [...lines, ''])

		expect(lane_ledger_tail.read_since(target, since(2), SMALL_CHUNK_BYTES)).toStrictEqual({
			entries: [merge_on(2), merge_on(3)],
			reached_start: false,
		})
	})

	it('returns nothing when no line is in the window', () => {
		const after_last = since(3) + 1

		expect(lane_ledger_tail.read_since(days_ledger('none'), after_last)).toStrictEqual({
			entries: [],
			reached_start: false,
		})
	})
})

describe('lane_ledger_tail.read_since on the bytes it reads', () => {
	it('joins lines cut by a chunk boundary', () => {
		const target = days_ledger('chunks')

		expect(lane_ledger_tail.read_since(target, since(1), SMALL_CHUNK_BYTES)).toStrictEqual({
			entries: [merge_on(1), merge_on(2), merge_on(3)],
			reached_start: false,
		})
	})

	it('skips a malformed line as read does', () => {
		const lines = [JSON.stringify(merge_on(1)), '{"kind":', JSON.stringify(merge_on(2)), '']
		const target = ledger_of('malformed', lines)

		expect(lane_ledger_tail.read_since(target, since(1), SMALL_CHUNK_BYTES)).toStrictEqual({
			entries: [merge_on(1), merge_on(2)],
			reached_start: true,
		})
		expect(lane_ledger_tail.read(target)).toStrictEqual([merge_on(1), merge_on(2)])
	})

	it('reads an absent ledger as an empty window at its start', () => {
		expect(lane_ledger_tail.read_since(ledger('absent'), since(0))).toStrictEqual({
			entries: [],
			reached_start: true,
		})
	})
})

describe('lane_ledger_tail.read on a line still landing', () => {
	it('counts it once it is complete, never twice', () => {
		const target = ledger('fragment')

		lane_ledger_write.append(target, merge(1))
		appendFileSync(target, JSON.stringify(merge(9)))

		expect(lane_ledger_tail.read(target)).toStrictEqual([merge(1), merge(9)])

		appendFileSync(target, '\n')
		lane_ledger_write.append(target, merge(10))

		expect(lane_ledger_tail.read(target)).toStrictEqual([merge(1), merge(9), merge(10)])
	})
})

function is_odd(entry: object): boolean {
	return 'issue' in entry && Number(entry.issue) % 2 === 1
}

// joshuafolkken/kit#8034: a store of its own holds only the entries its filter passes.
describe('lane_ledger_tail.tail_store', () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('holds only the kept entries and parses only the appended lines', () => {
		const target = ledger('store-append')
		const store = lane_ledger_tail.tail_store(is_odd)

		lane_ledger_write.append(target, merge(1))
		lane_ledger_write.append(target, merge(2))
		store.read(target)
		const parse = vi.spyOn(json_value, 'parse_or_undefined')

		lane_ledger_write.append(target, merge(3))

		expect(store.read(target)).toStrictEqual([merge(1), merge(3)])
		expect(parse.mock.calls.map(([line]) => line).filter(Boolean)).toStrictEqual([
			JSON.stringify(merge(3)),
		])
		expect(lane_ledger_tail.read(target)).toStrictEqual([merge(1), merge(2), merge(3)])
	})

	it('reads the whole file again once it forgets the path', () => {
		const target = ledger('store-forget')
		const store = lane_ledger_tail.tail_store(is_odd)

		lane_ledger_write.append(target, merge(1))
		const first = store.read(target)

		store.forget(target)

		expect(store.read(target)).not.toBe(first)
		expect(store.read(target)).toStrictEqual([merge(1)])
	})
})

// Past one chunk of the backward read (`CHUNK_BYTES` in `lane-ledger-tail.ts`).
const LONGER_THAN_A_CHUNK = 70_000

function issue_of(entry: object): unknown {
	return 'issue' in entry ? entry.issue : undefined
}

function appended_lines(parse: { mock: { calls: Array<Array<unknown>> } }): Array<unknown> {
	return parse.mock.calls.map(([line]) => line).filter(Boolean)
}

// joshuafolkken/kit#8133: a window asked for again and again while the ledger grows.
describe('lane_ledger_tail.window_store on a growing ledger', () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('returns the kept entries of the window, oldest first', () => {
		const store = lane_ledger_tail.window_store(is_odd)

		expect(store.read(days_ledger('window-store'), since(1))).toStrictEqual([
			merge_on(1),
			merge_on(3),
		])
	})

	it('parses only the appended line, and nothing for a later start', () => {
		const target = days_ledger('window-grow')
		const store = lane_ledger_tail.window_store()

		store.read(target, since(2))
		appendFileSync(target, `${JSON.stringify(merge_on(3))}\n`)
		const parse = vi.spyOn(json_value, 'parse_or_undefined')

		expect(store.read(target, since(2))).toStrictEqual([merge_on(2), merge_on(3), merge_on(3)])
		expect(store.read(target, since(3))).toStrictEqual([merge_on(3), merge_on(3)])
		expect(appended_lines(parse)).toStrictEqual([JSON.stringify(merge_on(3))])
	})

	it('reads backward again for an earlier start', () => {
		const target = days_ledger('window-earlier')
		const store = lane_ledger_tail.window_store()

		store.read(target, since(2))

		expect(store.read(target, since(1))).toStrictEqual([merge_on(1), merge_on(2), merge_on(3)])
	})
})

describe('lane_ledger_tail.window_store on a replaced or landing ledger', () => {
	it('reads a replaced ledger backward again', () => {
		const target = days_ledger('window-replaced')
		const replacement = ledger_of('window-replacement', [JSON.stringify(merge_on(2)), ''])
		const store = lane_ledger_tail.window_store()

		store.read(target, since(0))
		renameSync(replacement, target)

		expect(store.read(target, since(0))).toStrictEqual([merge_on(2)])
	})

	it('counts a line still landing once it is complete, never twice', () => {
		const target = days_ledger('window-fragment')
		const store = lane_ledger_tail.window_store()

		appendFileSync(target, JSON.stringify(merge_on(3)))

		expect(store.read(target, since(3))).toStrictEqual([merge_on(3), merge_on(3)])

		appendFileSync(target, '\n')

		expect(store.read(target, since(3))).toStrictEqual([merge_on(3), merge_on(3)])
	})

	it('counts a landing line longer than a chunk once it is complete', () => {
		const target = days_ledger('window-long-fragment')
		const store = lane_ledger_tail.window_store()
		const long = { ...merge_on(3), note: 'x'.repeat(LONGER_THAN_A_CHUNK) }

		appendFileSync(target, JSON.stringify(long))
		store.read(target, since(3))
		appendFileSync(target, '\n')

		expect(store.read(target, since(3)).map((entry) => issue_of(entry))).toStrictEqual([3, 3])
	})

	it('reads an absent ledger as no entries', () => {
		expect(lane_ledger_tail.window_store().read(ledger('window-absent'), since(0))).toStrictEqual(
			[],
		)
	})
})
