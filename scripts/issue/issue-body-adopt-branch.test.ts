import { describe, expect, it } from 'vitest'
import { issue_body_adopt_branch } from './issue-body-adopt-branch'

const SHA = 'abc1234def'
const ROW = { branch: 'wip/x', sha: SHA }
const JA_LINE = `- 取り込むブランチ: wip/x @ ${SHA}`
const EN_LINE = `- Adopt branch: wip/x @ ${SHA}`
const NO_SHA_LINE = '- 取り込むブランチ: wip/x'
const HEAD_LINES = ['## 概要', '', 'text', '', '## 背景', '']
const KIND_LINE = '- 種別: 非不具合'
const BODY = [...HEAD_LINES, KIND_LINE, ''].join('\n')

describe('issue_body_adopt_branch.read', () => {
	it('reads none from a body without the row', () => {
		expect(issue_body_adopt_branch.read(BODY)).toStrictEqual({ kind: 'none' })
	})

	it.each([JA_LINE, EN_LINE])('reads the branch and sha from %s', (row_line) => {
		expect(issue_body_adopt_branch.read(`${BODY}\n${row_line}`)).toStrictEqual({
			kind: 'row',
			row: ROW,
		})
	})

	it.each([
		['the branch missing', `- 取り込むブランチ: @ ${SHA}`],
		['the sha missing', NO_SHA_LINE],
		['a branch outside wip/', `- 取り込むブランチ: feature/x @ ${SHA}`],
		['two rows', `${JA_LINE}\n${EN_LINE}`],
	])('reads a row with %s as malformed', (_case, rows) => {
		expect(issue_body_adopt_branch.read(`${BODY}\n${rows}`).kind).toBe('malformed')
	})
})

describe('issue_body_adopt_branch.problems', () => {
	it('refuses a malformed row and passes a well-formed one or none', () => {
		expect(issue_body_adopt_branch.problems(`${BODY}\n${NO_SHA_LINE}`)).toHaveLength(1)
		expect(issue_body_adopt_branch.problems(`${BODY}\n${JA_LINE}`)).toStrictEqual([])
		expect(issue_body_adopt_branch.problems(BODY)).toStrictEqual([])
	})
})

describe('issue_body_adopt_branch.with_row', () => {
	it('inserts the row before the first bullet under the background heading', () => {
		const result = issue_body_adopt_branch.with_row(BODY, ROW)

		const expected = [...HEAD_LINES, JA_LINE, KIND_LINE, '']

		expect(result).toStrictEqual({ body: expected.join('\n') })
	})

	it('leaves a body naming the same row unchanged', () => {
		const body = `${BODY}\n${JA_LINE}`

		expect(issue_body_adopt_branch.with_row(body, ROW)).toStrictEqual({ body })
	})

	it('refuses a body naming another row', () => {
		const result = issue_body_adopt_branch.with_row(`${BODY}\n${JA_LINE}`, {
			...ROW,
			sha: 'fff9999',
		})

		expect(result).toHaveProperty('problem')
	})
})

describe('issue_body_adopt_branch environment', () => {
	it('round-trips the row through the handed-down value', () => {
		const value = issue_body_adopt_branch.to_environment(ROW)

		expect(issue_body_adopt_branch.from_environment(value)).toStrictEqual(ROW)
	})

	it('reads no row from an absent or shapeless value', () => {
		expect(issue_body_adopt_branch.from_environment(undefined)).toBeUndefined()
		expect(issue_body_adopt_branch.from_environment('wip/x')).toBeUndefined()
	})

	it('puts the handed-down row into the filed body and leaves it alone without one', () => {
		const value = issue_body_adopt_branch.to_environment(ROW)

		expect(issue_body_adopt_branch.with_handoff_row(BODY, { value })).toStrictEqual(
			issue_body_adopt_branch.with_row(BODY, ROW),
		)
		expect(issue_body_adopt_branch.with_handoff_row(BODY, { value: '' })).toStrictEqual({
			body: BODY,
		})
	})

	it('leaves the row out of a follow-up or split filing naming --found-during', () => {
		const value = issue_body_adopt_branch.to_environment(ROW)

		expect(
			issue_body_adopt_branch.with_handoff_row(BODY, { found_during: '9148', value }),
		).toStrictEqual({ body: BODY })
	})

	it('leaves the row out of a --route split child of a several-deliverable kickoff new', () => {
		const value = issue_body_adopt_branch.to_environment(ROW)

		expect(
			issue_body_adopt_branch.with_handoff_row(BODY, { route: 'route:split', value }),
		).toStrictEqual({ body: BODY })
		expect(
			issue_body_adopt_branch.with_handoff_row(BODY, { route: 'route:tier-a', value }),
		).toStrictEqual(issue_body_adopt_branch.with_row(BODY, ROW))
	})
})
