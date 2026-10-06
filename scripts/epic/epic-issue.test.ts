import { describe, expect, it } from 'vitest'
import { epic_issue } from './epic-issue'

describe('epic_issue.parse_epic_issue — body (issue #3273)', () => {
	it('reads a JSON null body as an empty string', () => {
		expect(epic_issue.parse_epic_issue('{"number":1,"body":null}')?.body).toBe('')
	})

	it('reads a missing body as an empty string', () => {
		expect(epic_issue.parse_epic_issue('{"number":1}')?.body).toBe('')
	})

	it('keeps a present body as written', () => {
		expect(epic_issue.parse_epic_issue('{"number":1,"body":"text"}')?.body).toBe('text')
	})
})
