import { describe, expect, it } from 'vitest'
import { issue_auto_ok } from './issue-auto-ok'
import { issue_handoff_filing } from './issue-handoff-filing'
import { HANDOFF_IMPLEMENTING_LABEL } from './issue-labels'

// joshuafolkken/kit#9143: a handed-off `fullrun new` child's filing was opted into `auto-ok` and
// offered to `backlogrun` beside the run that implements it.

const NOT_NEEDED_BODY = '## 背景\n\n- 種別: 不具合\n- 人の判断: 不要\n'
const RUN_LANE = 'run:lane'
const FULLRUN_NEW = 'fullrun new'
const KICKOFF_NEW = 'kickoff new'

function handed(line: string): NodeJS.ProcessEnv {
	return { JOSH_HANDOFF_CHILD: '1', JOSH_HANDOFF_KEYWORD: line }
}

function decision_in(environment: NodeJS.ProcessEnv): ReturnType<typeof issue_auto_ok.decide> {
	const labels = issue_handoff_filing.with_label([RUN_LANE], environment)

	return issue_auto_ok.decide({
		is_opted_out: false,
		is_cross_repository: false,
		labels,
		body: NOT_NEEDED_BODY,
	})
}

describe('issue_handoff_filing.with_label — a handed-off implementing run', () => {
	it.each([FULLRUN_NEW, 'halfrun new', 'prrun new', '  fullrun   new  '])(
		'adds the exclusion label for %s',
		(line) => {
			expect(issue_handoff_filing.with_label([RUN_LANE], handed(line))).toStrictEqual([
				RUN_LANE,
				HANDOFF_IMPLEMENTING_LABEL,
			])
		},
	)

	it('adds the label once when a --label already named it', () => {
		const labels = [HANDOFF_IMPLEMENTING_LABEL]

		expect(issue_handoff_filing.with_label(labels, handed(FULLRUN_NEW))).toBe(labels)
	})

	it('withholds auto-ok from a body declaring no judgement is needed, naming why', () => {
		const decision = decision_in(handed(FULLRUN_NEW))

		expect(decision.is_applied).toBe(false)
		expect(issue_auto_ok.line_of(decision)).toContain(
			'filed by a handed-off fullrun/halfrun/prrun new, which implements it itself',
		)
	})
})

describe('issue_handoff_filing.with_label — every other filing is judged as before', () => {
	it.each([
		[KICKOFF_NEW, handed(KICKOFF_NEW)],
		['a numbered fullrun', handed('fullrun 9142')],
		['a bare keyword', handed('fullrun')],
		['a line without the hand-off mark', { JOSH_HANDOFF_KEYWORD: FULLRUN_NEW }],
		['no hand-off', {}],
	])('leaves the labels alone for %s', (_name, environment) => {
		const labels = [RUN_LANE]

		expect(issue_handoff_filing.with_label(labels, environment)).toBe(labels)
	})

	it('still applies auto-ok to a kickoff new filing', () => {
		expect(decision_in(handed(KICKOFF_NEW)).is_applied).toBe(true)
	})
})
