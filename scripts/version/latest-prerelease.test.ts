import { describe, expect, it } from 'vitest'
import { latest_prerelease } from './latest-prerelease'

const STYLISTIC = '@stylistic/eslint-plugin'
const STABLE_RANGE = '^5.10.0'
const BETA_RANGE = '^6.0.0-beta.6'
const KEPT = { name: STYLISTIC, kept: STABLE_RANGE, offered: BETA_RANGE }

function manifest(
	dependencies: Record<string, string>,
	development?: Record<string, string>,
): string {
	return JSON.stringify({ dependencies, devDependencies: development ?? {} }, undefined, '\t')
}

describe('latest_prerelease.find_new_prereleases', () => {
	// The defect this exists for: the stable major is inside the minimum release age while an older
	// prerelease of it is not, and `--latest` moves a stable range onto that prerelease.
	it('reports a stable range that moved onto a prerelease', () => {
		const before = manifest({}, { [STYLISTIC]: STABLE_RANGE })
		const after = manifest({}, { [STYLISTIC]: BETA_RANGE })

		expect(latest_prerelease.find_new_prereleases(before, after)).toStrictEqual([KEPT])
	})

	it('reports nothing when a prerelease range moves to a newer prerelease', () => {
		const before = manifest({ [STYLISTIC]: '^6.0.0-beta.5' })
		const after = manifest({ [STYLISTIC]: BETA_RANGE })

		expect(latest_prerelease.find_new_prereleases(before, after)).toStrictEqual([])
	})

	it('reports nothing when a prerelease range moves to the stable release', () => {
		const before = manifest({ [STYLISTIC]: BETA_RANGE })
		const after = manifest({ [STYLISTIC]: '^6.0.0' })

		expect(latest_prerelease.find_new_prereleases(before, after)).toStrictEqual([])
	})

	it('ignores ranges semver cannot read and packages that were removed', () => {
		const before = manifest({ pkg: 'workspace:*', gone: STABLE_RANGE })
		const after = manifest({ pkg: BETA_RANGE })

		expect(latest_prerelease.find_new_prereleases(before, after)).toStrictEqual([])
	})
})

describe('latest_prerelease.with_stable_ranges', () => {
	it('puts the stable range back and leaves the other entries as the update wrote them', () => {
		const after = manifest({ tsx: '^4.24.0' }, { [STYLISTIC]: BETA_RANGE })

		expect(latest_prerelease.with_stable_ranges(after, [KEPT])).toBe(
			manifest({ tsx: '^4.24.0' }, { [STYLISTIC]: STABLE_RANGE }),
		)
	})
})

describe('latest_prerelease.format_stable_kept_notice', () => {
	it('names the kept range and the prerelease it was offered', () => {
		const notice = latest_prerelease.format_stable_kept_notice([KEPT])

		expect(notice).toContain(`${STYLISTIC}@${STABLE_RANGE}`)
		expect(notice).toContain(`prerelease ${BETA_RANGE}`)
	})

	// Unlike a downgrade, only this entry was kept back; a reader must not think the run did nothing.
	it('says the rest of the update went through', () => {
		expect(latest_prerelease.format_stable_kept_notice([KEPT])).toContain(
			'rest of the update went through',
		)
	})
})
