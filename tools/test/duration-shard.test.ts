import { describe, expect, it } from 'vitest'
import { duration_shard, type Durations } from './duration-shard'

// joshuafolkken/kit#4467: the CI unit shards split by recorded duration, not by file count.

const COUNT = 3
const SLOWEST = 'a.test.ts'
const UNRECORDED = 'new.test.ts'
const RECORDED: ReadonlyArray<[string, number]> = [
	[SLOWEST, 90],
	['b.test.ts', 60],
	['c.test.ts', 50],
	['d.test.ts', 40],
	['e.test.ts', 30],
	['f.test.ts', 30],
]
const DURATIONS: Durations = Object.fromEntries(RECORDED)
const FILES = RECORDED.map(([file]) => file)

function total(shard: ReadonlyArray<string>): number {
	return shard.reduce((sum, file) => sum + (DURATIONS[file] ?? 0), 0)
}

function by_path(left: string, right: string): number {
	return left.localeCompare(right)
}

describe('duration_shard.assign — every file in exactly one shard', () => {
	it('partitions the files: the union is every file and none repeats', () => {
		const flat = duration_shard.assign(FILES, DURATIONS, COUNT).flat()

		expect(flat.toSorted(by_path)).toStrictEqual(FILES)
		expect(new Set(flat).size).toBe(flat.length)
	})

	it('answers the same split whatever order the files arrive in', () => {
		const forward = duration_shard.assign(FILES, DURATIONS, COUNT)
		const reversed = duration_shard.assign(FILES.toReversed(), DURATIONS, COUNT)

		expect(reversed).toStrictEqual(forward)
	})

	it('balances the shard totals by duration, not by file count', () => {
		const totals = duration_shard.assign(FILES, DURATIONS, COUNT).map((shard) => total(shard))

		expect(totals).toStrictEqual([120, 90, 90])
	})

	it('puts a file with no record into a shard by the median of the recorded ones', () => {
		const shards = duration_shard.assign([UNRECORDED, SLOWEST], DURATIONS, COUNT)

		expect(shards).toStrictEqual([[SLOWEST], [UNRECORDED], []])
	})

	it('counts a file listed twice once', () => {
		const flat = duration_shard.assign([SLOWEST, SLOWEST], DURATIONS, COUNT).flat()

		expect(flat).toStrictEqual([SLOWEST])
	})
})

describe('duration_shard.median — the weight of an unrecorded file', () => {
	it('takes the middle value, the lower one of an even count', () => {
		expect(duration_shard.median([30, 10, 20])).toBe(20)
		expect(duration_shard.median([40, 10, 20, 30])).toBe(20)
	})

	it('falls back to a fixed weight when nothing is recorded', () => {
		expect(duration_shard.median([])).toBe(duration_shard.FALLBACK_MS)
	})
})

describe('duration_shard.shard_files — the files of one 1-based shard', () => {
	it('answers the shard `--shard=<index>/<count>` names', () => {
		const shards = duration_shard.assign(FILES, DURATIONS, COUNT)

		expect(duration_shard.shard_files(FILES, DURATIONS, 2, COUNT)).toStrictEqual(shards[1])
	})
})
