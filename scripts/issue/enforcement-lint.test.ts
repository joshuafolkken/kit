import { describe, expect, it } from 'vitest'
import { enforcement_lint } from './enforcement-lint'

const ENFORCEMENT = '- 強制: `pnpm josh issue:lint`'
const MEASUREMENT = '- 計測: `pnpm josh lane:stats` の違反件数'
const MEASUREMENT_ONLY = '- 強制: 計測のみ'
const ENFORCEMENT_KEY = '- 強制:'
const MEASUREMENT_KEY = '- 計測:'

function body_with(lines: ReadonlyArray<string>): string {
	return ['## 背景', '', '- 種別: 振る舞い変更', ...lines, '', 'なぜ必要か', '', '## 現象'].join(
		'\n',
	)
}

// The one problem a body has, so a case pins which declaration it names.
function sole_problem(lines: ReadonlyArray<string>): string | undefined {
	const found = enforcement_lint.problems(body_with(lines))

	return found.length === 1 ? found[0] : undefined
}

describe('enforcement_lint.problems', () => {
	it('passes a behavior-change body that declares both lines', () => {
		expect(enforcement_lint.problems(body_with([ENFORCEMENT, MEASUREMENT]))).toStrictEqual([])
	})

	it('passes measurement-only enforcement when a measurement is named', () => {
		expect(enforcement_lint.problems(body_with([MEASUREMENT_ONLY, MEASUREMENT]))).toStrictEqual([])
	})

	it('refuses a body missing either line', () => {
		expect(sole_problem([MEASUREMENT])).toContain(ENFORCEMENT_KEY)
		expect(sole_problem([ENFORCEMENT])).toContain(MEASUREMENT_KEY)
		expect(enforcement_lint.problems(body_with([]))).toHaveLength(2)
	})

	it('refuses a none, empty or unfilled placeholder value', () => {
		expect(sole_problem(['- 強制: なし', MEASUREMENT])).toContain(ENFORCEMENT_KEY)
		expect(sole_problem([ENFORCEMENT, '- 計測:'])).toContain(MEASUREMENT_KEY)
		expect(sole_problem(['- 強制: <hook・lint・gate>', MEASUREMENT])).toContain(ENFORCEMENT_KEY)
	})

	it('refuses measurement-only enforcement with no measurement as prose alone', () => {
		expect(sole_problem([MEASUREMENT_ONLY, '- 計測: なし'])).toContain(MEASUREMENT_KEY)
	})

	it('does not read a fenced example as the declaration', () => {
		const fenced = ['```md', ENFORCEMENT, MEASUREMENT, '```']

		expect(enforcement_lint.problems(body_with(fenced))).toHaveLength(2)
	})

	it('ignores the lines outside the background section', () => {
		const body = [body_with([]), '', ENFORCEMENT, MEASUREMENT].join('\n')

		expect(enforcement_lint.problems(body)).toHaveLength(2)
	})

	it('holds a body that does not declare a behavior change to nothing', () => {
		const body = ['## 背景', '', '- 種別: 非不具合', '', 'なぜ必要か'].join('\n')

		expect(enforcement_lint.problems(body)).toStrictEqual([])
	})
})
