import type { BacklogIssue } from '#scripts/epic/epic-bundle'
import { describe, expect, it } from 'vitest'
import { measure_twin } from './measure-twin'
import { session_cite } from './session-cite'

const REPO = 'joshuafolkken/kit'
const OPEN = 5978
const OTHER = 5990
const DECLARED = '- 計測宣言: `pnpm josh cost:audit --density --period 7` >= 1.47'

function body_of(line: string): string {
	return `## 背景\n\n${line}\n\n## 現象\n\nx\n`
}

function issue_of(number: number, line: string): BacklogIssue {
	return { number, repo: REPO, body: body_of(line), blocked_by: [] }
}

const BACKLOG = [
	issue_of(OPEN, DECLARED),
	issue_of(OTHER, '- 計測宣言: `pnpm josh cost:audit --density --period 7` >= 2'),
]

describe('measure_twin.twins_of', () => {
	it('names the open issue declaring the same measurement', () => {
		expect(measure_twin.twins_of(body_of(DECLARED), BACKLOG)).toStrictEqual([OPEN])
	})

	it('matches a declaration that differs only in spacing and number form', () => {
		const spaced = '- 計測宣言: `pnpm josh cost:audit --density --period 7`>=1.470'

		expect(measure_twin.twins_of(body_of(spaced), BACKLOG)).toStrictEqual([OPEN])
	})

	it('names none for a different bound, operator or command', () => {
		for (const line of [
			'- 計測宣言: `pnpm josh cost:audit --density --period 7` >= 1.5',
			'- 計測宣言: `pnpm josh cost:audit --density --period 7` > 1.47',
			'- 計測宣言: `pnpm josh cost:audit --density --period 14` >= 1.47',
		]) {
			expect(measure_twin.twins_of(body_of(line), BACKLOG)).toStrictEqual([])
		}
	})

	it('names none for a body with no declaration or one declared absent', () => {
		for (const line of ['- 種別: 非不具合', '- 計測宣言なし: Actions の記録で測る']) {
			expect(measure_twin.twins_of(body_of(line), BACKLOG)).toStrictEqual([])
		}
	})
})

describe('measure_twin.problem', () => {
	it('answers nothing when no open issue declares the measurement', () => {
		expect(measure_twin.problem([])).toBeUndefined()
	})

	it('names every twin and the issue:comment to join it with', () => {
		const problem = measure_twin.problem([OPEN, OTHER])

		expect(problem).toContain(`${session_cite.issue(OPEN)}, ${session_cite.issue(OTHER)}`)
		expect(problem).toContain('pnpm josh issue:comment <N>')
	})
})
