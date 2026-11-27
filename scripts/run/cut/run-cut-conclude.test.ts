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

const NONE: ReadonlyArray<string> = []

describe('run_cut_conclude.missing_of', () => {
	it('answers nothing missing for a #7780-shaped body with no changed file (ac-1b7874a6)', () => {
		expect(run_cut_conclude.missing_of(body_of(0, CHECKED), NONE)).toBeUndefined()
	})

	it('names an unchecked acceptance criterion (ac-5424e7c4)', () => {
		const criteria = [...CHECKED.slice(1), '- [ ] five']

		expect(run_cut_conclude.missing_of(body_of(0, criteria), NONE)).toBe(
			'1 acceptance criteria are unchecked',
		)
	})

	it('closes a body whose estimate counted a one-off scratch script when nothing changed (ac-8a75444b)', () => {
		expect(run_cut_conclude.missing_of(body_of(1, CHECKED), NONE)).toBeUndefined()
	})

	it('names the changed file even when the body declares a 0-file estimate (ac-8a75444b)', () => {
		expect(run_cut_conclude.missing_of(body_of(0, CHECKED), ['a.ts'])).toBe('the lane changed a.ts')
	})

	it('names the files the lane changed (ac-5424e7c4)', () => {
		expect(run_cut_conclude.missing_of(body_of(0, CHECKED), ['a.ts', 'b.md'])).toBe(
			'the lane changed a.ts, b.md',
		)
	})

	it('ignores a checkbox outside the acceptance criteria section', () => {
		const body = `${body_of(0, CHECKED)}\n\n## メモ\n\n- [ ] not a criterion`

		expect(run_cut_conclude.missing_of(body, NONE)).toBeUndefined()
	})
})
