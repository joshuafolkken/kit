import { describe, expect, it } from 'vitest'
import { acceptance_map } from './acceptance-map'
import { acceptance_map_defer } from './acceptance-map-defer'

// joshuafolkken/kit#9146: which criteria the Issue leaves unaccounted for, and what the refusal says.

const BODY = [
	'## 受け入れ条件',
	'- [x] Ticked',
	'- [ ] Open met',
	'- [ ] Open moved',
	'- [ ] Marked → #9104',
].join('\n')
const CRITERIA = acceptance_map.criteria_of(BODY)
const [, OPEN_MET, OPEN_MOVED, MARKED] = CRITERIA
const ROWS = acceptance_map.rows_of(
	[
		acceptance_map.MAP_HEADING,
		`- \`${OPEN_MET?.id ?? ''}\` Open met — 満たした: a test`,
		`- \`${OPEN_MOVED?.id ?? ''}\` 見送り: #9104 split off`,
	].join('\n'),
)

describe('acceptance_map_defer.open_criteria', () => {
	it('at the merge names every open criterion (ac-ddfdb837)', () => {
		expect(acceptance_map_defer.open_criteria(CRITERIA, ROWS, false)).toEqual([
			OPEN_MET,
			OPEN_MOVED,
		])
	})

	it('before the gate names only those with a deferral row (ac-31166520)', () => {
		expect(acceptance_map_defer.open_criteria(CRITERIA, ROWS, true)).toEqual([OPEN_MOVED])
	})
})

describe('acceptance_map_defer — marks and their targets', () => {
	it('lists the marked criteria', () => {
		expect(acceptance_map_defer.marked(CRITERIA)).toEqual([MARKED])
		expect(MARKED?.deferred_to).toBe('#9104')
	})

	it.each([
		[`引き継ぎ: #9103 \`${MARKED?.id ?? ''}\``, true],
		['## 受け入れ条件\n- [ ] Rewritten', false],
		[undefined, false],
	])('carries(%s) is %s (ac-6d0affff)', (target, expected) => {
		expect(acceptance_map_defer.carries(target, MARKED?.id ?? '')).toBe(expected)
	})

	it('writes a reference line naming the source and the identifier', () => {
		expect(acceptance_map_defer.reference_line('9103', 'ac-1', 'split off')).toBe(
			// The target's body is rendered by GitHub, so the source stays a plain `#N`.
			'引き継ぎ: #9103 `ac-1` split off',
		)
	})
})

describe('acceptance_map_defer.resolution_lines', () => {
	it('is clear and silent with nothing open or dropped', () => {
		const resolution = { open: [], dropped: [] }

		expect(acceptance_map_defer.is_clear(resolution)).toBe(true)
		expect(acceptance_map_defer.resolution_lines('9103', resolution)).toEqual([])
	})

	it('names the open and the dropped criteria with the commands that settle them', () => {
		const resolution = {
			open: CRITERIA.slice(2, 3),
			dropped: acceptance_map_defer.marked(CRITERIA),
		}
		const text = acceptance_map_defer.resolution_lines('9103', resolution).join('\n')

		expect(acceptance_map_defer.is_clear(resolution)).toBe(false)
		expect(text).toContain(`\`${OPEN_MOVED?.id ?? ''}\` Open moved`)
		expect(text).toContain(`\`${MARKED?.id ?? ''}\` → #9104`)
		expect(text).toContain('pnpm josh issue:defer 9103')
	})
})
