import { describe, expect, it } from 'vitest'
import { figure_source_lint } from './figure-source-lint'

// joshuafolkken/kit#7021: a figure under the background or expected-effect heading names its source.

const BACKGROUND = '## 背景\n\n'
const EFFECT = '## 期待効果\n\n'

describe('figure_source_lint.warnings', () => {
	it('warns about a background figure with no command and no prediction', () => {
		const found = figure_source_lint.warnings(`${BACKGROUND}中央値 約 35 分 / 100 行\n`)

		expect(found).toStrictEqual([expect.stringContaining('約 35 分 / 100 行')])
	})

	it('warns about a keyed background bullet the template does not declare', () => {
		const found = figure_source_lint.warnings(
			`${BACKGROUND}- 見積もり: implement 約 35 分 / 100 行\n`,
		)

		expect(found).toStrictEqual([expect.stringContaining('約 35 分')])
	})

	it('reads a backticked name with no argument as no source', () => {
		const found = figure_source_lint.warnings(`${BACKGROUND}\`issue:file\` は約 35 分を通した\n`)

		expect(found).toHaveLength(1)
	})

	it('warns about an expected-effect figure with no source', () => {
		const found = figure_source_lint.warnings(`${EFFECT}- 1 回あたりの得: 約 6 分 → 約 1 分\n`)

		expect(found).toStrictEqual([expect.stringContaining('約 6 分')])
	})
})

describe('figure_source_lint.warnings — sourced or not a figure', () => {
	it.each([
		[
			'a backticked command',
			`${BACKGROUND}177 レーン中央値 16.9 分（\`pnpm josh lane:stats --period 3\`）\n`,
		],
		['the prediction word', `${BACKGROUND}予測: 約 35 分 / 100 行\n`],
		['only issue references and a date', `${BACKGROUND}2026-11-10 に #7005 と #6982 で起きた\n`],
		[
			'a background declaration line',
			`${BACKGROUND}- 規模見積もり: 約 4 ファイル / 50 行（テスト除く）\n`,
		],
		['a start date declaration', `${BACKGROUND}- 実施可能日: 2026-11-10T12:00Z\n`],
		[
			'a no-measurement declaration',
			`${BACKGROUND}- 計測宣言なし: マージ後に 1 コマンドで集計する値が無い\n`,
		],
		['a figure in a fenced output', `${BACKGROUND}\`\`\`\n| 177 | 16.9 |\n\`\`\`\n`],
		['a figure under another heading', `## 現象\n\n約 35 分\n`],
		['an ordered-list marker', `${BACKGROUND}1. 予算を守る\n`],
	])('does not warn about %s', (_case, body) => {
		expect(figure_source_lint.warnings(body)).toStrictEqual([])
	})
})
