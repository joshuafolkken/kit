import { describe, expect, it } from 'vitest'
import { epic_split_reach, type SplitChild } from './epic-split-reach'

const CREATOR = 5708
const IMPORTER = 5710
const NEW_MODULE = 'scripts/run/board/run-board-throughput.ts'
const EXISTING_MODULE = 'scripts/run/board/run-board-read.ts'

// joshuafolkken/kit#5705's split, its change sections reduced to the code spans the check reads: the
// derivation child creates the module, and only the drawing child names it as the one it calls.
const DERIVATION_BODY = [
	'## 変更内容',
	'',
	`- \`${NEW_MODULE}\`（新規）: イベントストリームからセルを返す`,
	'- close 時刻: `run-board-status.ts` の `ENDING_STATES` を共有する',
].join('\n')
const DRAWING_BODY = [
	'値の導出（`run-board-throughput.ts`）は先行する子 Issue が担う。',
	'',
	'## 変更内容',
	'',
	'- `scripts/run/board/run-board-render-throughput.ts`（新規）: 2 行を描く',
	`- \`${EXISTING_MODULE}\` / \`run-board-render.ts\`: 描画まで渡す`,
].join('\n')

const SPLIT_5705: ReadonlyArray<SplitChild> = [
	{ number: CREATOR, body: DERIVATION_BODY },
	{ number: IMPORTER, body: DRAWING_BODY },
]

function is_present(path: string): boolean {
	return path === EXISTING_MODULE
}

describe('epic_split_reach.stranded_modules — the joshuafolkken/kit#5705 split', () => {
	it('finds the derivation module whose only importer is the sibling', () => {
		expect(epic_split_reach.stranded_modules(SPLIT_5705, is_present)).toStrictEqual([
			{ child: CREATOR, module: NEW_MODULE, importers: [IMPORTER] },
		])
	})

	it('refuses the split, naming the child, the module and the importer', () => {
		const refusal = epic_split_reach.format_refusal(
			epic_split_reach.stranded_modules(SPLIT_5705, is_present),
		)

		expect(refusal).toContain(`#${String(CREATOR)}`)
		expect(refusal).toContain(NEW_MODULE)
		expect(refusal).toContain(`#${String(IMPORTER)}`)
		expect(refusal).toContain('nothing was written')
	})
})

describe('epic_split_reach.stranded_modules — splits each child can merge alone', () => {
	it('passes a child that also declares an existing scripts file to import from', () => {
		const wired = `${DERIVATION_BODY}\n- \`${EXISTING_MODULE}\`: gather から呼ぶ`
		const children = [{ number: CREATOR, body: wired }, SPLIT_5705[1] ?? { number: IMPORTER }]

		expect(epic_split_reach.stranded_modules(children, is_present)).toStrictEqual([])
	})

	it('passes a new module no sibling names', () => {
		const children = [
			SPLIT_5705[0] ?? { number: CREATOR },
			{ number: IMPORTER, body: '`docs/a.md`' },
		]

		expect(epic_split_reach.stranded_modules(children, is_present)).toStrictEqual([])
	})

	it('ignores a new test file a sibling names', () => {
		const test_file = 'scripts/run/board/run-board-throughput.test.ts'
		const children = [
			{ number: CREATOR, body: `\`${test_file}\`` },
			{ number: IMPORTER, body: `\`${test_file}\`` },
		]

		expect(epic_split_reach.stranded_modules(children, is_present)).toStrictEqual([])
	})

	it('reads a child whose body could not be read as declaring nothing', () => {
		const children = [{ number: CREATOR }, SPLIT_5705[1] ?? { number: IMPORTER }]

		expect(epic_split_reach.stranded_modules(children, is_present)).toStrictEqual([])
	})
})
