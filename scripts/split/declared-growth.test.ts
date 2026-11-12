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

describe('split notice growth', () => {
	const DECLARED = { files: 2, lines: 40 }
	const GUIDE = split_assess.guide_for(12, undefined, { files: 1.5, lines: 1.25 })

	it('uses independent file and line boundaries (ac-54136377)', () => {
		expect(
			split_assess.notice({ files: 3, lines: 50, verdict: 'single' }, DECLARED, GUIDE),
		).toBeUndefined()
		expect(
			split_assess.notice({ files: 4, lines: 50, verdict: 'single' }, DECLARED, GUIDE),
		).toBeDefined()
		expect(
			split_assess.notice({ files: 3, lines: 51, verdict: 'single' }, DECLARED, GUIDE),
		).toBeDefined()
	})

	it('prints guide and axis growth values with their sources (ac-75138e94)', () => {
		const notice = split_assess.notice({ files: 4, lines: 50, verdict: 'single' }, DECLARED, GUIDE)

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
