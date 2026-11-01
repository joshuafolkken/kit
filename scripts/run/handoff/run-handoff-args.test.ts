import { describe, expect, it } from 'vitest'
import { run_handoff_args } from './run-handoff-args'

// joshuafolkken/kit#5352: the keyword, the entry typed after it, and the brief `josh run:handoff` reads.

const BRIEF_FLAG = '--brief-file'
const BRIEF = 'brief.md'

describe('run_handoff_args.parse', () => {
	it('reads kickoff new with its brief, keeping the keyword line as typed', () => {
		expect(run_handoff_args.parse(['kickoff', 'new', BRIEF_FLAG, BRIEF])).toEqual({
			kind: 'workflow',
			keyword: 'kickoff',
			line: 'kickoff new',
			brief_file: BRIEF,
		})
	})

	it('keeps the entry tokens on either side of the brief flag', () => {
		const parsed = run_handoff_args.parse(['fullrun', BRIEF_FLAG, BRIEF, '#12', '#13'])

		expect(parsed).toMatchObject({ kind: 'workflow', line: 'fullrun #12 #13', brief_file: BRIEF })
	})

	it('hands a bare number to the child as an issue, since a shell drops an unquoted #N', () => {
		const parsed = run_handoff_args.parse(['fullrun', '12', 'new', BRIEF_FLAG, BRIEF])

		expect(parsed).toMatchObject({ kind: 'workflow', line: 'fullrun #12 new' })
	})

	it('passes backlogrun through whole, without a brief', () => {
		expect(run_handoff_args.parse(['backlogrun', '#7', '--only'])).toEqual({
			kind: 'backlogrun',
			rest: ['#7', '--only'],
		})
	})

	it.each([
		{ argv: [], why: 'no keyword' },
		{ argv: ['deploy', BRIEF_FLAG, BRIEF], why: 'an unknown keyword' },
		{ argv: ['halfrun', '#3'], why: 'no brief flag' },
		{ argv: ['prrun', '#3', BRIEF_FLAG], why: 'a brief flag with no value' },
		{ argv: ['prrun', BRIEF_FLAG, '--x'], why: 'a brief flag followed by a flag' },
		{ argv: ['fullrun', BRIEF_FLAG, 'a', BRIEF_FLAG, 'b'], why: 'a repeated brief flag' },
	])('refuses $why', ({ argv }) => {
		expect(run_handoff_args.parse(argv)).toMatchObject({ kind: 'refused' })
	})
})
