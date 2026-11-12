import { describe, expect, it } from 'vitest'
import { run_handoff_final } from './run-handoff-final'

// joshuafolkken/kit#5352: what a handed-off child said last, and the URLs it names.

const ISSUE_URL = 'https://github.com/joshuafolkken/kit/issues/5400'
const PR_URL = 'https://github.com/joshuafolkken/kit/pull/5401'
const FILED = 'Filed #5400'

function claude_result(text: string): string {
	return JSON.stringify({ type: 'result', result: text })
}

function codex_message(text: string): string {
	return JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text } })
}

describe('run_handoff_final.final_message', () => {
	it('reads the Claude result event under the launcher header', () => {
		const log = ['launched claude (pid 1)', claude_result(FILED)].join('\n')

		expect(run_handoff_final.final_message(log)).toBe(FILED)
	})

	it('reads the last Codex agent message', () => {
		const log = [codex_message('working'), '{"type":"turn.completed"}', codex_message('done')]

		expect(run_handoff_final.final_message(log.join('\n'))).toBe('done')
	})

	it('answers undefined for a log with no final message', () => {
		expect(run_handoff_final.final_message('not json\n{"type":"system"}')).toBeUndefined()
	})
})

describe('run_handoff_final.github_urls', () => {
	it('lists each Issue and pull request URL once, in order', () => {
		const text = `Filed ${ISSUE_URL} and opened ${PR_URL}; see ${ISSUE_URL}. Docs: https://github.com/x`

		expect(run_handoff_final.github_urls(text)).toEqual([ISSUE_URL, PR_URL])
	})

	it('answers an empty list for text with no URL', () => {
		expect(run_handoff_final.github_urls('nothing created')).toEqual([])
	})
})
