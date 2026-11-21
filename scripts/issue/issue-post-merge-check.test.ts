import { describe, expect, it } from 'vitest'
import { issue_post_merge_check } from './issue-post-merge-check'

const WHERE = '`run:board` の matrix テーマの TRACE 行'
const BACKGROUND = '## 背景'
const SYMPTOM = '## 現象'
const JUDGEMENT = '- 人の判断: 不要'
const DECLARATION = `- マージ後の確認: ${WHERE}`

function body_of(lines: ReadonlyArray<string>): string {
	return lines.join('\n')
}

describe('issue_post_merge_check.answer', () => {
	it('answers the declared place to look', () => {
		const body = body_of([BACKGROUND, '', JUDGEMENT, DECLARATION, '', SYMPTOM, ''])

		expect(issue_post_merge_check.answer(body)).toBe(`post_merge_check: ${WHERE}`)
	})

	it('answers none when the background declares no post-merge check', () => {
		const body = body_of([BACKGROUND, '', JUDGEMENT, '', SYMPTOM, ''])

		expect(issue_post_merge_check.answer(body)).toBe('post_merge_check: none')
	})

	it('ignores the declaration outside the background section', () => {
		const body = body_of([BACKGROUND, '', JUDGEMENT, '', SYMPTOM, '', DECLARATION])

		expect(issue_post_merge_check.read(body)).toBeUndefined()
	})

	// The template and the filed issues (#8391) write it as a bare line, not a bullet.
	it('reads the declaration written as a bare line', () => {
		const body = body_of([BACKGROUND, '', JUDGEMENT, '', `マージ後の確認: ${WHERE}`, '', SYMPTOM])

		expect(issue_post_merge_check.read(body)).toBe(WHERE)
	})

	it('reads the English key as well', () => {
		const body = body_of([BACKGROUND, '', `- Post-merge check: ${WHERE}`, ''])

		expect(issue_post_merge_check.read(body)).toBe(WHERE)
	})
})
