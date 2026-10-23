import type { BlockRead } from '#scripts/issue/issue-read-cli'
import type { StateRead } from '#scripts/issue/issue-state-cli'
import { describe, expect, it } from 'vitest'
import { run_entry_trust } from './run-entry-trust'

function content(
	is_body_trusted: boolean | undefined,
	has_trusted_comment: boolean | undefined,
): BlockRead {
	return { kind: 'ok', block: '', trust: { is_body_trusted, has_trusted_comment } }
}

function state(labels: Array<string>): StateRead {
	return { kind: 'state', state: { state: 'OPEN', labels, is_human_review: false } }
}

const PLANNED = ['run:planned']
const UNREAD_STATE: StateRead = { kind: 'unreadable' }
const ISSUE = '12'
const GO = undefined
const KICKOFF = '`kickoff #12`'
const { STOP_REASON: UNTRUSTED, UNREAD_REASON: UNREAD } = run_entry_trust

describe('run_entry_trust.stop_of (joshuafolkken/kit#4663, #4703)', () => {
	it.each([
		['a trusted author', content(true, false), state([]), GO],
		['an untrusted author with no plan', content(false, false), state([]), UNTRUSTED],
		['an untrusted author with only a trusted comment', content(false, true), state([]), UNTRUSTED],
		[
			'an untrusted author with only the plan label',
			content(false, false),
			state(PLANNED),
			UNTRUSTED,
		],
		['an untrusted author planned by a trusted kickoff', content(false, true), state(PLANNED), GO],
		['a failed body author lookup', content(undefined, false), state([]), UNREAD],
		[
			'a failed comment listing on a planned issue',
			content(false, undefined),
			state(PLANNED),
			UNREAD,
		],
		[
			'a failed comment listing on an unplanned issue',
			content(false, undefined),
			state([]),
			UNTRUSTED,
		],
		['a failed body lookup cleared by a kickoff', content(undefined, true), state(PLANNED), GO],
		['a failed label read with a trusted comment', content(false, true), UNREAD_STATE, UNREAD],
		['a failed label read with no trusted comment', content(false, false), UNREAD_STATE, UNTRUSTED],
		['a read that failed, left to the rereads it prompts', { kind: 'unreadable' }, state([]), GO],
	] as const)('answers %s', (_label, read, issue_state, expected) => {
		expect(run_entry_trust.stop_of(read, issue_state, ISSUE)?.reason).toBe(expected)
	})
})

describe('run_entry_trust.stop_of — what the stop recommends', () => {
	it('names kickoff for the issue in an untrusted stop', () => {
		const stop = run_entry_trust.stop_of(content(false, false), state([]), ISSUE)

		expect(stop?.report).toContain(KICKOFF)
		expect(stop?.recommended).toContain(KICKOFF)
	})

	it('names the failed read, not kickoff, in a failed-read stop', () => {
		const stop = run_entry_trust.stop_of(content(undefined, false), state([]), ISSUE)

		expect(stop?.report).toContain('trust read failed')
		expect(stop?.recommended).not.toContain('kickoff')
	})
})
