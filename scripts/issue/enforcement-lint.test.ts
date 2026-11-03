import { describe, expect, it } from 'vitest'
import { enforcement_lint } from './enforcement-lint'

const ENFORCEMENT = '- 強制: `pnpm josh issue:lint`'
const MEASUREMENT = '- 計測: `pnpm josh lane:stats` の違反件数'
const MEASUREMENT_ONLY = '- 強制: 計測のみ'

function body_with(lines: ReadonlyArray<string>): string {
	return ['## 背景', '', '- 種別: 振る舞い変更', ...lines, '', 'なぜ必要か', '', '## 現象'].join(
		'\n',
	)
}

describe('enforcement_lint.problems', () => {
	it('passes a behavior-change body that declares both lines', () => {
		expect(enforcement_lint.problems(body_with([ENFORCEMENT, MEASUREMENT]))).toStrictEqual([])
	})

	it('passes measurement-only enforcement when a measurement is named', () => {
		expect(enforcement_lint.problems(body_with([MEASUREMENT_ONLY, MEASUREMENT]))).toStrictEqual([])
	})

	it('refuses a body missing either line', () => {
		expect(enforcement_lint.problems(body_with([MEASUREMENT]))).toHaveLength(1)
		expect(enforcement_lint.problems(body_with([ENFORCEMENT]))).toHaveLength(1)
		expect(enforcement_lint.problems(body_with([]))).toHaveLength(2)
	})

	it('refuses a none or empty value', () => {
		expect(enforcement_lint.problems(body_with(['- 強制: なし', MEASUREMENT]))).toHaveLength(1)
		expect(enforcement_lint.problems(body_with([ENFORCEMENT, '- 計測:']))).toHaveLength(1)
	})

	it('refuses measurement-only enforcement with no measurement as prose alone', () => {
		expect(enforcement_lint.problems(body_with([MEASUREMENT_ONLY, '- 計測: なし']))).toHaveLength(1)
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
