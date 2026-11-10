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
