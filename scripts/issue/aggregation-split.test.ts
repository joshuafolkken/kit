import { describe, expect, it } from 'vitest'
import { aggregation_split } from './aggregation-split'

const AGGREGATION = '- [ ] トランスクリプトからフィルタの形を集計し Issue にコメントで記録する'
const IMPLEMENTATION = '- [ ] `issue:lint` が拒否する'
// joshuafolkken/kit#5238: #5202's first criterion, a measurement with no aggregation word.
const MEASUREMENT =
	'- [ ] `scripts/lane/lane-ledger.ts` の読み手側の変更で `pnpm josh test:related` が回すテストファイル数が before の 1/2 以下になる（before / after を Issue にコメントで記録）'

function body(files: number, criterion: string): string {
	return [
		'## 背景',
		'',
		`- 規模見積もり: 約 ${String(files)} ファイル / 80 行（テスト除く）`,
		'',
		'## 受け入れ条件',
		'',
		criterion,
		'',
	].join('\n')
}

const REFUSED = [
	{ name: 'an aggregation-comment criterion', criterion: AGGREGATION },
	{ name: 'a before / after measurement', criterion: MEASUREMENT },
	{ name: 'a 計測 record', criterion: '- [ ] 到達テスト数を計測し Issue にコメントで記録する' },
	{ name: 'a 変更前後 record', criterion: '- [ ] 変更前後の出力を Issue のコメントに記録する' },
]

const PASSED = [
	{ name: 'an aggregation alone', files: 1, criterion: AGGREGATION },
	{ name: 'a measurement alone, the prior split Issue', files: 1, criterion: MEASUREMENT },
	{
		name: 'a before / after comparison recorded nowhere on an Issue',
		files: 6,
		criterion: '- [ ] `pnpm josh lane:stats` の出力が before と同じ',
	},
	{ name: 'an implementation alone', files: 6, criterion: IMPLEMENTATION },
	{
		name: 'an implementation citing the prior aggregation',
		files: 6,
		criterion: '- [ ] #5200 のコメントに記録した Issue の集計に沿って実装する',
	},
	{
		name: 'a feature posting an aggregate as a PR comment',
		files: 6,
		criterion: '- [ ] `josh metrics` が失敗を集計し PR コメントに投稿する',
	},
]

describe('aggregation_split.problems', () => {
	it.each(REFUSED)('refuses $name beside an implementation estimate', ({ criterion }) => {
		const [problem, ...rest] = aggregation_split.problems(
			body(aggregation_split.IMPLEMENTATION_FILES, criterion),
		)

		expect(rest).toStrictEqual([])
		expect(problem).toContain('--route split')
		expect(problem).toContain('prior Issue')
		expect(problem).toContain('an aggregation or a measurement')
	})

	it.each(PASSED)('passes $name', ({ files, criterion }) => {
		expect(aggregation_split.problems(body(files, criterion))).toStrictEqual([])
	})

	it('ignores an aggregation mentioned outside the acceptance criteria', () => {
		const text = `## 背景\n\n${AGGREGATION}\n${body(6, IMPLEMENTATION)}`

		expect(aggregation_split.problems(text)).toStrictEqual([])
	})

	it('ignores an aggregation criterion inside a code fence', () => {
		expect(aggregation_split.problems(body(6, `\`\`\`md\n${AGGREGATION}\n\`\`\``))).toStrictEqual(
			[],
		)
	})
})
