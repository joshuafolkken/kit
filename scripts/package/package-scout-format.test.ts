import { describe, expect, it } from 'vitest'
import { package_scout, type PackageMetrics } from './package-scout'
import { package_scout_format } from './package-scout-format'

// The printed shape: one line per candidate with each metric, and a verdict line whose wording keys
// off the tier vocabulary (joshuafolkken/kit#2216).

function metrics(overrides: Partial<PackageMetrics>): PackageMetrics {
	return {
		name: 'zod',
		version: '3.23.8',
		score: 0.91,
		weekly_downloads: 12_345_678,
		last_publish: '2025-08-01T00:00:00.000Z',
		has_bundled_types: true,
		license: 'MIT',
		install_size_bytes: 1_258_291,
		...overrides,
	}
}

const CLEAR = 'Tier: clear'

function pair(top_score: number, runner_score: number): Array<PackageMetrics> {
	return [metrics({ name: 'a', score: top_score }), metrics({ name: 'b', score: runner_score })]
}

describe('per-metric formatting', () => {
	it('groups download thousands without a locale', () => {
		expect(package_scout_format.group_thousands(12_345_678)).toBe('12,345,678')
	})

	it('shows a blank for an unreported download count', () => {
		expect(package_scout_format.format_downloads(undefined)).toBe('—')
	})

	it('trims a publish timestamp to its date', () => {
		expect(package_scout_format.format_date('2025-08-01T12:34:56.000Z')).toBe('2025-08-01')
	})

	it('scales bytes to a binary unit', () => {
		expect(package_scout_format.format_size(1_258_291)).toBe('1.2 MB')
		expect(package_scout_format.format_size(512)).toBe('512 B')
		expect(package_scout_format.format_size(undefined)).toBe('—')
	})
})

describe('format_row prints one candidate with every labelled metric', () => {
	const row = package_scout_format.format_row(0, metrics({}))

	it('opens with the rank and the name at version', () => {
		expect(row).toContain('#1')
		expect(row).toContain('zod@3.23.8')
	})

	it('labels each measured metric', () => {
		expect(row).toContain('score 0.91')
		expect(row).toContain('dl 12,345,678/wk')
		expect(row).toContain('pub 2025-08-01')
		expect(row).toContain('types ✓')
		expect(row).toContain('lic MIT')
		expect(row).toContain('size 1.2 MB')
	})

	it('marks a package without bundled types', () => {
		const without = package_scout_format.format_row(1, metrics({ has_bundled_types: false }))

		expect(without).toContain('types ✗')
	})
})

describe('the verdict line follows the tier vocabulary', () => {
	it('names Tier A when the leader is clear', () => {
		const verdict = package_scout_format.format_verdict(package_scout.build_table(pair(0.9, 0.7)))

		expect(verdict).toContain(CLEAR)
		expect(verdict).toContain('Tier A')
	})

	it('names Tier B when the top two are close', () => {
		const verdict = package_scout_format.format_verdict(package_scout.build_table(pair(0.9, 0.88)))

		expect(verdict).toContain('Tier: close')
		expect(verdict).toContain('Tier B')
	})

	it('calls a lone candidate the pick', () => {
		const verdict = package_scout_format.format_verdict(
			package_scout.build_table([metrics({ name: 'only' })]),
		)

		expect(verdict).toContain('only')
		expect(verdict).toContain(CLEAR)
	})

	it('reports no candidates', () => {
		const empty = package_scout_format.format_table(package_scout.build_table([]))

		expect(empty).toBe(package_scout_format.NO_CANDIDATES_LINE)
	})
})
