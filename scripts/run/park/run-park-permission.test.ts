import { describe, expect, it } from 'vitest'
import { run_park_permission } from './run-park-permission'

const NAME = 'option 1'
const PARENT_CLOSE = '親（issue:close）'
const CLOSE_FORM = `"${PARENT_CLOSE}"`
const FILING_FORM = '"親（issue:file …）"'

// joshuafolkken/kit#7818: the permission line is limited to the vocabulary the schema shows.
describe('run_park_permission.problem_of', () => {
	it.each([
		'なし',
		'親',
		'owner コメント',
		'epic 編集',
		'信頼設定',
		'人',
		PARENT_CLOSE,
		'owner コメント（#123）',
		'親 (issue:file --route interrupt)',
	])('accepts %j (ac-4435f76d)', (permission) => {
		expect(run_park_permission.problem_of(NAME, permission)).toBeUndefined()
	})

	it.each(['Issue のクローズ', 'Issue の起票', 'Issue 本文の編集', '親セッション'])(
		'refuses %j, showing the close and filing forms (ac-4435f76d, ac-55aaf50e)',
		(permission) => {
			const problem = run_park_permission.problem_of(NAME, permission)

			expect(problem).toContain(`${NAME} names "${permission}" as its permission`)
			expect(problem).toContain(CLOSE_FORM)
			expect(problem).toContain(FILING_FORM)
		},
	)
})

// joshuafolkken/kit#9172: `--adopt` refuses every tier C option, so a tier C option naming the
// parent's permission is a park no one can take.
describe('run_park_permission.tier_problem', () => {
	it.each([PARENT_CLOSE, '親'])('refuses tier C with %j, showing the person form', (permission) => {
		const problem = run_park_permission.tier_problem(NAME, { tier: 'C', permission })

		expect(problem).toContain(`${NAME} is tier C, a person's to take, but names "${permission}"`)
		expect(problem).toContain('"- 必要な権限: 人" with a "person:" outcome, or tier A|B')
	})

	it.each([
		['C', '人'],
		['C', '信頼設定'],
		['A', PARENT_CLOSE],
		['B', '親（issue:file …）'],
		['A', 'なし'],
	])('accepts tier %s with %j', (tier, permission) => {
		expect(run_park_permission.tier_problem(NAME, { tier, permission })).toBeUndefined()
	})

	it('reports the vocabulary problem before the pairing', () => {
		const problem = run_park_permission.option_problem(NAME, {
			tier: 'C',
			permission: '親セッション',
		})

		expect(problem).toContain(`${NAME} names "親セッション" as its permission`)
	})
})

// joshuafolkken/kit#7818: the schema a parking child sees is built from the same vocabulary.
describe('run_park_permission.schema_lines', () => {
	it('lists every word and the close and filing forms (ac-97034bd0)', () => {
		const schema = run_park_permission.schema_lines().join('\n')

		expect(schema).toContain('必要な権限: なし | 親 | owner コメント | epic 編集 | 信頼設定 | 人')
		expect(schema).toContain(`必要な権限: ${CLOSE_FORM.replaceAll('"', '')}`)
		expect(schema).toContain(`必要な権限: ${FILING_FORM.replaceAll('"', '')}`)
	})
})
