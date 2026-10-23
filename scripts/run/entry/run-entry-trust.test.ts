import type { BlockRead } from '#scripts/issue/issue-read-cli'
import type { StateRead } from '#scripts/issue/issue-state-cli'
import { describe, expect, it } from 'vitest'
import { run_entry_trust } from './run-entry-trust'

function content(is_body_trusted: boolean, has_trusted_comment: boolean): BlockRead {
	return { kind: 'ok', block: '', trust: { is_body_trusted, has_trusted_comment } }
}

function state(labels: Array<string>): StateRead {
	return { kind: 'state', state: { state: 'OPEN', labels, is_human_review: false } }
}

const PLANNED = ['run:planned']

describe('run_entry_trust.needs_trusted_plan (joshuafolkken/kit#4663)', () => {
	it.each([
		['a trusted author', content(true, false), state([]), false],
		['an untrusted author with no plan', content(false, false), state([]), true],
		['an untrusted author with only a trusted comment', content(false, true), state([]), true],
		['an untrusted author with only the plan label', content(false, false), state(PLANNED), true],
		[
			'an untrusted author planned by a trusted kickoff',
			content(false, true),
			state(PLANNED),
			false,
		],
		[
			'a read that failed, left to the rereads it prompts',
			{ kind: 'unreadable' },
			state([]),
			false,
		],
	] as const)('answers %s', (_label, read, issue_state, expected) => {
		expect(run_entry_trust.needs_trusted_plan(read, issue_state)).toBe(expected)
	})

	it('names kickoff for the issue in the stop note', () => {
		expect(run_entry_trust.stop_note('12')).toContain('`kickoff #12`')
	})
})
