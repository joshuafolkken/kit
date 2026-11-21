import { describe, expect, it } from 'vitest'
import { declared_growth } from './declared-growth'
import { split_assess } from './split-assess'

describe('declared growth', () => {
	it('falls back independently while preserving measured zero (ac-45cdc50c)', () => {
		expect(declared_growth.factor({ files: 0 }, 'files')).toBe(0)
		expect(declared_growth.factor({ files: 0 }, 'lines')).toBe(2)
		expect(declared_growth.factor({ lines: 1.2 }, 'files')).toBe(2)
		expect(declared_growth.factor(undefined, 'lines')).toBe(2)
	})
})

const DECLARED = { files: 2, lines: 40 }
const GUIDE = split_assess.guide_for(12, undefined, { files: 1.5, lines: 1.25 })

// The notice for a single-verdict diff of this size against the declaration and measured growth.
function grown_notice(files: number, lines: number): string | undefined {
	return split_assess.notice(
		{ files, lines, verdict: 'single' },
		{ declared: DECLARED, guide: GUIDE },
	)
}

describe('split notice growth', () => {
	it('uses independent file and line boundaries (ac-54136377)', () => {
		expect(grown_notice(3, 50)).toBeUndefined()
		expect(grown_notice(4, 50)).toBeDefined()
		expect(grown_notice(3, 51)).toBeDefined()
	})

	it('prints guide and axis growth values with their sources (ac-75138e94)', () => {
		const notice = grown_notice(4, 50)

		expect(notice).toContain('guide 8 files / 200 lines (fallback)')
		expect(notice).toContain('growth files × 1.5 (measured) / lines × 1.25 (measured)')
	})

	it('prints measured guide and independently missing growth sources (ac-75138e94)', () => {
		const guide = split_assess.guide_for(12, { median: 3, lanes: 1 }, { lines: 0 })
		const reason = split_assess.reason({ files: 1, lines: 1, verdict: 'single', guide })

		expect(reason).toContain('guide 16 files / 400 lines (measured)')
		expect(reason).toContain('growth files × 2 (fallback) / lines × 0 (measured)')
	})
})
