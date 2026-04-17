import { describe, expect, it } from 'vitest'
import { issue_logic } from './issue-logic'

const COLLAB_SCRIPTS_TITLE = 'Add collaboration scripts'
const COLLAB_SCRIPTS_SLUG = 'add-collaboration-scripts'
const FIX_LOGIN_TITLE = 'Fix login bug'

describe('issue_logic.has_cjk', () => {
	it('returns true for Japanese text', () => {
		expect(issue_logic.has_cjk('コラボスクリプトを作成する')).toBe(true)
	})

	it('returns true for Chinese characters', () => {
		expect(issue_logic.has_cjk('创建协作脚本')).toBe(true)
	})

	it('returns true for Korean text', () => {
		expect(issue_logic.has_cjk('협업 스크립트 만들기')).toBe(true)
	})

	it('returns true for mixed text', () => {
		expect(issue_logic.has_cjk('Add 自動化 scripts')).toBe(true)
	})

	it('returns false for English text', () => {
		expect(issue_logic.has_cjk('Add collaboration workflow scripts')).toBe(false)
	})

	it('returns false for empty string', () => {
		expect(issue_logic.has_cjk('')).toBe(false)
	})
})

describe('issue_logic.slugify', () => {
	it('converts title to kebab-case slug', () => {
		expect(issue_logic.slugify(COLLAB_SCRIPTS_TITLE)).toBe(COLLAB_SCRIPTS_SLUG)
	})

	it('strips special characters', () => {
		expect(issue_logic.slugify('Fix: ArrowDown bug (editor)')).toBe('fix-arrowdown-bug-editor')
	})

	it('returns "update" for empty result', () => {
		expect(issue_logic.slugify('日本語タイトル')).toBe('update')
	})

	it('truncates long slugs', () => {
		const long_title =
			'Add explicit rule to AI instruction files to prevent removal of pnpm overrides entries'
		const slug = issue_logic.slugify(long_title)

		expect(slug.length).toBeLessThanOrEqual(50)
		expect(slug).not.toMatch(/-$/u)
	})
})

describe('issue_logic.suggest_branch_name', () => {
	it('generates branch name from issue number and title', () => {
		const result = issue_logic.suggest_branch_name(189, COLLAB_SCRIPTS_TITLE)

		expect(result).toBe(`189-${COLLAB_SCRIPTS_SLUG}`)
	})
})

describe('issue_logic.prepare', () => {
	it('returns full prep result for English title', () => {
		const result = issue_logic.prepare(42, FIX_LOGIN_TITLE)

		expect(result.number).toBe(42)
		expect(result.title).toBe(FIX_LOGIN_TITLE)
		expect(result.is_cjk).toBe(false)
		expect(result.suggested_branch).toBe('42-fix-login-bug')
	})

	it('flags CJK title', () => {
		const result = issue_logic.prepare(10, 'ログインバグ修正')

		expect(result.is_cjk).toBe(true)
	})
})
