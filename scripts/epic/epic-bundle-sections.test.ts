import { describe, expect, it } from 'vitest'
import { epic_bundle, type BacklogIssue } from './epic-bundle'

// joshuafolkken/kit#3956: a number written only as the example that prompted the filing bundled
// issues whose work never overlaps. Only the acceptance criteria and the parent line count.

const REPO = 'joshuafolkken/kit'

function issue(number: number, options: Partial<BacklogIssue> = {}): BacklogIssue {
	return { number, repo: REPO, body: '', blocked_by: [], ...options }
}

describe('epic_bundle.is_strong_signal — where a reference was written', () => {
	it('ignores a reference made only in the symptom section', () => {
		const subject = issue(1, { body: '## 現象\n\nfound while filing #2\n\n## 受け入れ条件\n\n- x' })

		expect(epic_bundle.is_strong_signal(subject, issue(2))).toBe(false)
	})

	it('ignores a reference made only in the background section', () => {
		const subject = issue(1, { body: '## Background\n\nsee #2' })

		expect(epic_bundle.decide_bundle(subject, [issue(2)]).action).toBe('none')
	})

	it('counts a reference made in the Japanese acceptance criteria', () => {
		const subject = issue(1, { body: '## 背景\n\nsee #3\n\n## 受け入れ条件\n\n- [ ] extends #2' })

		expect(epic_bundle.decide_bundle(subject, [issue(2), issue(3)]).candidates).toEqual([2])
	})

	it('counts the parent line wherever it sits', () => {
		expect(epic_bundle.is_strong_signal(issue(1, { body: 'parent: #2' }), issue(2))).toBe(true)
	})

	it('counts the Japanese parent line', () => {
		expect(epic_bundle.is_strong_signal(issue(1, { body: '親: #2' }), issue(2))).toBe(true)
	})

	it('still counts a recorded dependency whatever the body says', () => {
		const blocker = { repo: REPO, number: 2 }
		const subject = issue(1, { body: '## Background\n\nunrelated', blocked_by: [blocker] })

		expect(epic_bundle.is_strong_signal(subject, issue(2))).toBe(true)
	})
})
