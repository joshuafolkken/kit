import { describe, expect, it } from 'vitest'
import { run_cut_conclude } from './run-cut-conclude'

// joshuafolkken/kit#7821: the three conditions a no-diff investigation lane closes on, read off a
// #7780-shaped body — a 0-file estimate, every acceptance criterion checked, and no changed file.

const CHECKED = ['- [x] one', '- [x] two', '- [x] three', '- [x] four', '- [x] five']

function body_of(files: number, criteria: ReadonlyArray<string>): string {
	return [
		'## 背景',
		'',
		`- 規模見積もり: 約 ${String(files)} ファイル / 0 行（テスト除く）`,
		'',
		'## 受け入れ条件',
		'',
		...criteria,
	].join('\n')
}

describe('run_cut_conclude.missing_of', () => {
	it('answers nothing missing for a #7780-shaped body with no changed file (ac-1b7874a6)', () => {
		expect(run_cut_conclude.missing_of(body_of(0, CHECKED), 0)).toBeUndefined()
	})

	it('names an unchecked acceptance criterion (ac-5424e7c4)', () => {
		const criteria = [...CHECKED.slice(1), '- [ ] five']

		expect(run_cut_conclude.missing_of(body_of(0, criteria), 0)).toBe(
			'1 acceptance criteria are unchecked',
		)
	})

	it('names a non-zero file estimate (ac-5424e7c4)', () => {
		expect(run_cut_conclude.missing_of(body_of(1, CHECKED), 0)).toContain('0-file size estimate')
	})

	it('names a lane that changed a file (ac-5424e7c4)', () => {
		expect(run_cut_conclude.missing_of(body_of(0, CHECKED), 1)).toBe('the lane changed 1 file(s)')
	})

	it('ignores a checkbox outside the acceptance criteria section', () => {
		const body = `${body_of(0, CHECKED)}\n\n## メモ\n\n- [ ] not a criterion`

		expect(run_cut_conclude.missing_of(body, 0)).toBeUndefined()
	})
})
