import { describe, expect, it } from 'vitest'
import { latest_regression } from './latest-regression'

const TSX = 'tsx'

function manifest(
	dependencies: Record<string, string>,
	development?: Record<string, string>,
): string {
	return JSON.stringify({ dependencies, devDependencies: development ?? {} })
}

describe('latest_regression.read_direct_dependencies', () => {
	it('merges dependencies and devDependencies', () => {
		const content = manifest({ tsx: '^4.23.5' }, { vitest: '^4.1.10' })

		expect(latest_regression.read_direct_dependencies(content)).toStrictEqual({
			tsx: '^4.23.5',
			vitest: '^4.1.10',
		})
	})

	it('returns an empty record when a manifest declares no dependencies', () => {
		expect(latest_regression.read_direct_dependencies('{}')).toStrictEqual({})
	})
})

describe('latest_regression.find_regressions — the downgrade case', () => {
	// The defect this exists for: a suppressed newer version makes `--latest` resolve to an older
	// one, and the update writes it in silently.
	it('reports a package whose version floor moved down', () => {
		const before = manifest({ tsx: '^4.23.5' })
		const after = manifest({ tsx: '^4.23.1' })

		expect(latest_regression.find_regressions(before, after)).toStrictEqual([
			{ name: TSX, kept: '^4.23.5', offered: '^4.23.1' },
		])
	})

	it('reports a downgrade in devDependencies as well', () => {
		const before = manifest({}, { vitest: '^4.1.10' })
		const after = manifest({}, { vitest: '^4.0.1' })

		const names = latest_regression.find_regressions(before, after).map((item) => item.name)

		expect(names).toStrictEqual(['vitest'])
	})

	it('reports a major-version downgrade', () => {
		const before = manifest({ tsx: '^5.0.0' })
		const after = manifest({ tsx: '^4.23.1' })

		expect(latest_regression.find_regressions(before, after)).toHaveLength(1)
	})
})

describe('latest_regression.find_regressions — cases that are not regressions', () => {
	it('reports nothing when a package moved up', () => {
		const before = manifest({ tsx: '^4.23.1' })
		const after = manifest({ tsx: '^4.23.5' })

		expect(latest_regression.find_regressions(before, after)).toStrictEqual([])
	})

	it('reports nothing when a package is unchanged', () => {
		const content = manifest({ tsx: '^4.23.5' })

		expect(latest_regression.find_regressions(content, content)).toStrictEqual([])
	})

	it('ignores a package that was removed', () => {
		expect(
			latest_regression.find_regressions(manifest({ tsx: '^4.23.5' }), manifest({})),
		).toStrictEqual([])
	})

	it('ignores a package that was added', () => {
		expect(
			latest_regression.find_regressions(manifest({}), manifest({ tsx: '^4.23.5' })),
		).toStrictEqual([])
	})

	// There is no ordering to assert for these, and guessing one would revert updates that never
	// regressed.
	it('ignores ranges semver cannot order', () => {
		const before = manifest({ pkg: 'workspace:*' }, { other: 'github:owner/repo#main' })
		const after = manifest({ pkg: '^1.0.0' }, { other: '^1.0.0' })

		expect(latest_regression.find_regressions(before, after)).toStrictEqual([])
	})
})

describe('latest_regression.format_kept_back_notice', () => {
	it('names the kept version and the one the registry offered', () => {
		const notice = latest_regression.format_kept_back_notice([
			{ name: TSX, kept: '^4.23.5', offered: '^4.23.1' },
		])

		expect(notice).toContain('tsx@^4.23.5')
		expect(notice).toContain('newest allowed is ^4.23.1')
	})

	// The newer version is normally still published and still tagged latest; a minimum-age gate is
	// hiding it. Saying "the newest allowed version" keeps the notice true in that case.
	it('attributes the downgrade to the allowed set, not to the registry', () => {
		const notice = latest_regression.format_kept_back_notice([
			{ name: TSX, kept: '^4.23.5', offered: '^4.23.1' },
		])

		expect(notice).toContain('newest allowed version is older than the installed one')
	})

	// A reader told only "kept tsx" would assume the rest of the run went through. It did not: the
	// whole update is rolled back, because a pin above the allowed ceiling makes the tree
	// unresolvable and no partial update is possible.
	it('states that the whole update was rolled back', () => {
		const notice = latest_regression.format_kept_back_notice([
			{ name: TSX, kept: '^4.23.5', offered: '^4.23.1' },
		])

		expect(notice).toContain('rolled back and no dependency changed')
	})

	it('lists every kept-back package', () => {
		const notice = latest_regression.format_kept_back_notice([
			{ name: TSX, kept: '^4.23.5', offered: '^4.23.1' },
			{ name: 'vitest', kept: '^4.1.10', offered: '^4.0.1' },
		])

		expect(notice).toContain(TSX)
		expect(notice).toContain('vitest')
	})
})
