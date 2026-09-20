import { describe, expect, it } from 'vitest'
import { package_scout, type PackageMetrics, type SearchCandidate } from './package-scout'

// The transform (registry pieces → ranking row) and the near-tie boundary — the two halves the
// acceptance criteria pin, both pure so no registry is touched (joshuafolkken/kit#2216).

const PUBLISH_DATE = '2025-08-01T00:00:00.000Z'

function metrics(name: string, score: number): PackageMetrics {
	return {
		name,
		version: '1.0.0',
		score,
		weekly_downloads: undefined,
		last_publish: undefined,
		has_bundled_types: false,
		license: undefined,
		install_size_bytes: undefined,
	}
}

describe('to_metrics folds the search candidate and its facts into one row', () => {
	const candidate: SearchCandidate = {
		name: 'zod',
		version: '3.23.8',
		score: 0.91,
		last_publish: PUBLISH_DATE,
	}

	it('carries every measured metric through', () => {
		const row = package_scout.to_metrics(
			candidate,
			{ has_bundled_types: true, license: 'MIT', install_size_bytes: 1024 },
			123,
		)

		expect(row).toStrictEqual({
			name: 'zod',
			version: '3.23.8',
			score: 0.91,
			last_publish: PUBLISH_DATE,
			has_bundled_types: true,
			license: 'MIT',
			install_size_bytes: 1024,
			weekly_downloads: 123,
		})
	})

	it('leaves an unreported metric blank rather than dropping the row', () => {
		const row = package_scout.to_metrics(
			candidate,
			{ has_bundled_types: false, license: undefined, install_size_bytes: undefined },
			undefined,
		)

		expect(row.weekly_downloads).toBeUndefined()
		expect(row.license).toBeUndefined()
		expect(row.name).toBe('zod')
	})
})

describe('rank orders candidates strongest first', () => {
	it('sorts by score descending', () => {
		const ranked = package_scout.rank([metrics('b', 0.4), metrics('a', 0.9), metrics('c', 0.6)])

		expect(ranked.map((row) => row.name)).toStrictEqual(['a', 'c', 'b'])
	})

	it('keeps input order on a tie', () => {
		const ranked = package_scout.rank([metrics('first', 0.5), metrics('second', 0.5)])

		expect(ranked.map((row) => row.name)).toStrictEqual(['first', 'second'])
	})
})

describe('the near-tie verdict — a relative lead over the leader', () => {
	it('is clear when the relative lead is at the threshold', () => {
		// 100 → 85 is a 15% lead, exactly the threshold.
		const table = package_scout.build_table([metrics('a', 100), metrics('b', 85)])

		expect(table.gap).toBeCloseTo(package_scout.NEAR_TIE_THRESHOLD)
		expect(table.verdict).toBe('clear')
	})

	it('is close when the relative lead is just under the threshold', () => {
		// 100 → 90 is a 10% lead, inside the threshold.
		const table = package_scout.build_table([metrics('a', 100), metrics('b', 90)])

		expect(table.verdict).toBe('close')
	})

	it('scales the threshold with the leader, not an absolute difference', () => {
		// 766 → 417 is a 46% lead however large the raw scores are.
		const table = package_scout.build_table([metrics('a', 766), metrics('b', 417)])

		expect(table.gap).toBeCloseTo(0.4556, 3)
		expect(table.verdict).toBe('clear')
	})
})

describe('the near-tie verdict — the edges', () => {
	it('is close when the top two are tied', () => {
		const table = package_scout.build_table([metrics('a', 700), metrics('b', 700)])

		expect(table.gap).toBe(0)
		expect(table.verdict).toBe('close')
	})

	it('treats an all-zero score field as a near-tie rather than dividing by zero', () => {
		const table = package_scout.build_table([metrics('a', 0), metrics('b', 0)])

		expect(table.gap).toBe(0)
		expect(table.verdict).toBe('close')
	})

	it('has no verdict for a single candidate', () => {
		const table = package_scout.build_table([metrics('a', 700)])

		expect(table.gap).toBeUndefined()
		expect(table.verdict).toBeUndefined()
	})

	it('has no verdict for no candidates', () => {
		const table = package_scout.build_table([])

		expect(table.ranked).toStrictEqual([])
		expect(table.verdict).toBeUndefined()
	})

	it('reads the gap between the top two after ranking, not input order', () => {
		const table = package_scout.build_table([
			metrics('low', 20),
			metrics('top', 100),
			metrics('mid', 50),
		])

		expect(table.ranked[0]?.name).toBe('top')
		expect(table.gap).toBeCloseTo(0.5)
		expect(table.verdict).toBe('clear')
	})
})
