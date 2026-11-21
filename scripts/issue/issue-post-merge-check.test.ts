import { describe, expect, it } from 'vitest'
import { issue_post_merge_check } from './issue-post-merge-check'

const WHERE = '`run:board` の matrix テーマの TRACE 行'
const BACKGROUND = '## 背景'
const SYMPTOM = '## 現象'
const JUDGEMENT = '- 人の判断: 不要'
const DECLARATION = `- マージ後の確認: ${WHERE}`
const NONE_ANSWER = 'post_merge_check: none'

function body_of(lines: ReadonlyArray<string>): string {
	return lines.join('\n')
}

describe('issue_post_merge_check.answer', () => {
	it('answers the declared place to look', () => {
		const body = body_of([BACKGROUND, '', JUDGEMENT, DECLARATION, '', SYMPTOM, ''])

		expect(issue_post_merge_check.answer(body, true)).toBe(`post_merge_check: ${WHERE}`)
	})

	it('answers none when the background declares no post-merge check', () => {
		const body = body_of([BACKGROUND, '', JUDGEMENT, '', SYMPTOM, ''])

		expect(issue_post_merge_check.answer(body, true)).toBe(NONE_ANSWER)
	})

	// The declaration lets a run skip a stop, so an outsider's body cannot declare it.
	it('answers none for an untrusted body that declares one', () => {
		const body = body_of([BACKGROUND, '', DECLARATION, ''])

		expect(issue_post_merge_check.answer(body, false)).toBe(NONE_ANSWER)
	})

	it('answers unknown, not none, when the trust lookup failed', () => {
		const body = body_of([BACKGROUND, '', DECLARATION, ''])

		expect(issue_post_merge_check.answer(body, undefined)).toBe('post_merge_check: ?')
	})
})

describe('issue_post_merge_check.read', () => {
	// A canonical read would turn an English place opening with a fixed value ("last") into Japanese.
	it('keeps the place to look as the filer wrote it', () => {
		const body = body_of([BACKGROUND, '', '- Post-merge check: last row of the board', ''])

		expect(issue_post_merge_check.read(body)).toBe('last row of the board')
	})

	it('ignores a declaration inside a code fence', () => {
		const body = body_of([BACKGROUND, '', '```', DECLARATION, '```', ''])

		expect(issue_post_merge_check.read(body)).toBeUndefined()
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
