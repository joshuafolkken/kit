import { describe, expect, it } from 'vitest'
import { time_single_check } from './time-single-check'
import { time_spans } from './time-spans'
import { time_transcript_fixture } from './time-transcript-fixture'

// What makes two calls the same verification check (joshuafolkken/kit#1383).
//
// The cases split in two. The first group is the signature itself — the arguments are part of it, so
// a key that ignored them would report `josh test:related a.ts` and `josh test:related b.ts` as one
// call repeated, which is ordinary feedback reported as waste. The second is the allow-list: a
// command that is not a single check must carry no key at all, or the count this feeds is a count of
// something else.

const LINT = 'josh lint:related'
const TESTS = 'josh test:related'
const ONE_FILE = 'pnpm josh test:related a.ts'

describe('check_key — the signature', () => {
	it('carries the command and its arguments', () => {
		expect(time_single_check.check_key(TESTS, ONE_FILE)).toBe('josh test:related a.ts')
	})

	it('is the same key whatever order the arguments came in', () => {
		const first = time_single_check.check_key(TESTS, 'pnpm josh test:related a.ts b.ts')
		const second = time_single_check.check_key(TESTS, 'pnpm josh test:related b.ts a.ts')

		expect(second).toBe(first)
	})

	it('is a different key for different arguments', () => {
		const first = time_single_check.check_key(TESTS, ONE_FILE)
		const second = time_single_check.check_key(TESTS, 'pnpm josh test:related b.ts')

		expect(second).not.toBe(first)
	})

	it('folds an argument repeated in one call', () => {
		const doubled = time_single_check.check_key(TESTS, 'pnpm josh test:related a.ts a.ts')

		expect(doubled).toBe(time_single_check.check_key(TESTS, ONE_FILE))
	})

	it('keys a check called with no argument at all', () => {
		expect(time_single_check.check_key('josh lint', 'pnpm josh lint')).toBe('josh lint')
	})
})

// **`josh gate` and `josh eval:scope` are the two that must not be here**, and for opposite reasons:
// one *is* the gate this counts the probing in front of, and the other is a call the completion gate
// prescribes exactly once per run.
describe('check_key — what is not a single check', () => {
	it.each(['josh gate', 'josh eval:scope', 'josh git', 'josh followup', ''])(
		'answers NO_CHECK for %j',
		(command) => {
			expect(time_single_check.check_key(command, `pnpm ${command}`)).toBe(
				time_single_check.NO_CHECK,
			)
		},
	)
})

// The span carries the key, because a span keeps no input and nothing downstream could recover it.
describe('a parsed transcript carries the key', () => {
	const { at, josh_call_line, result_line, BRANCH } = time_transcript_fixture
	const text = [
		JSON.stringify({
			type: 'user',
			timestamp: at(0),
			gitBranch: BRANCH,
			message: { content: 'go' },
		}),
		josh_call_line(1, BRANCH, 'pnpm josh lint:related scripts/a.ts'),
		result_line(2, BRANCH),
	].join('\n')

	it('keys the tool span by the check and its argument', () => {
		const { spans } = time_spans.parse_timeline(text)
		const call = spans.find((span) => span.josh_command === LINT)

		expect(call?.check_key).toBe('josh lint:related scripts/a.ts')
	})
})
