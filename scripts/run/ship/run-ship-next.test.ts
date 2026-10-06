import { describe, expect, it } from 'vitest'
import { run_ship_next } from './run-ship-next'
import { run_ship_stage, type Stage } from './run-ship-stage'

// joshuafolkken/kit#2964: the ship-stop prompt carries the command that resumes each stopped stage, so
// a relaunched child never re-derives it from `chain-rule.md`.

const ISSUE = '2964'
const TITLE = `Put the next command in the prompt #${ISSUE}`
const BODY_PATH = 'scratchpad/evidence.md'
const BODY = ['--body-file', BODY_PATH]
const CITE = ['--cite', '2965']
const NOTIFY = ['--notify-message-file', 'notify body.txt']
const RESUME = { title: TITLE, flags: [...BODY, ...CITE], is_review: true }
const QUOTED = `--body-file ${BODY_PATH} --cite 2965 '${TITLE}'`
// A lane child's commit and push belong to the detached ship, so no route may name `josh git`.
const COMMIT_BY_HAND = 'josh git'
const ROUND_TWO_ASK = 'review:round2'
const { COMMAND } = run_ship_next
const { STAGE } = run_ship_stage
const BEFORE_ROUND_TWO = [STAGE.PREFLIGHT, STAGE.REVIEW, STAGE.GATE, STAGE.SYNC, STAGE.COMMIT]
const CONFLICTED = ['scripts/a.ts', 'scripts/b.ts']

describe('run_ship_next.next_step', () => {
	it.each(Object.values(STAGE))('names the stopped report first for %s', (stage: Stage) => {
		expect(run_ship_next.next_step(ISSUE, stage, RESUME)).toContain(`${COMMAND.LOG} ${ISSUE}`)
	})

	it.each(Object.values(STAGE))('never commits by hand in a lane child for %s', (stage: Stage) => {
		expect(run_ship_next.next_step(ISSUE, stage, RESUME)).not.toContain(COMMIT_BY_HAND)
	})

	// The supervisor skips a recorded round 1 and decides round 2 itself, so a reviewing ship is
	// re-detached as it was started — never with the second-round question in the prompt.
	it.each(BEFORE_ROUND_TWO)(
		're-detaches a reviewing ship with the review for %s',
		(stage: Stage) => {
			const step = run_ship_next.next_step(ISSUE, stage, RESUME)

			expect(step).toContain(`${COMMAND.DETACH_REVIEW} ${QUOTED}`)
			expect(step).not.toContain(ROUND_TWO_ASK)
			// Every command sits in its own code span: an even backtick count, none nested.
			expect(step.split('`').length % 2).toBe(1)
			expect(step).not.toContain('``')
		},
	)
})

// joshuafolkken/kit#3221: a ship stopped on a merge git could not finish names the unmerged paths, so
// the resumed session resolves them without reading the report first.
describe('run_ship_next.next_step for a conflict with the default branch', () => {
	it.each([STAGE.SYNC, STAGE.FOLLOWUP])('lists the conflicted files for %s', (stage: Stage) => {
		const step = run_ship_next.next_step(ISSUE, stage, { ...RESUME, conflicts: CONFLICTED })

		expect(step).toContain('scripts/a.ts, scripts/b.ts')
		expect(step).toContain('conflict markers')
		expect(step).toContain(COMMAND.DETACH)
	})
})

describe('run_ship_next.next_step for a ship started without a review', () => {
	// A ship re-detached without `--review` after round 2 runs the preflight, the gate and the commit
	// again; a review there would be a third round.
	it.each(BEFORE_ROUND_TWO)(
		're-detaches a non-reviewing %s stop without a review',
		(stage: Stage) => {
			const step = run_ship_next.next_step(ISSUE, stage, { ...RESUME, is_review: false })

			expect(step).toContain(`${COMMAND.DETACH} ${QUOTED}`)
			expect(step).not.toContain(COMMAND.DETACH_REVIEW)
			expect(step).not.toContain(ROUND_TWO_ASK)
		},
	)
})

describe('run_ship_next.next_step after the review rounds', () => {
	// Round 2 is final, so a fix after it ships without a third review.
	it.each([STAGE.ROUND_TWO, STAGE.FOLLOWUP, STAGE.REPORT])(
		're-detaches without a review for %s',
		(stage: Stage) => {
			const step = run_ship_next.next_step(ISSUE, stage, RESUME)

			expect(step).toContain(`${COMMAND.DETACH} ${QUOTED}`)
			expect(step).not.toContain(COMMAND.DETACH_REVIEW)
		},
	)
})

// The reviewer's failure: a preflight stopped on missing evidence re-ran without `--body-file` and
// stopped on the same evidence again.
describe('run_ship_next.resume_of', () => {
	const args = {
		title: `Carry the options #${ISSUE}`,
		number: ISSUE,
		notify: NOTIFY,
		body: BODY,
		body_path: BODY_PATH,
		cites: [CITE[1] ?? ''],
		is_review: true,
		is_detach: false,
	}

	it('keeps the stopped ship’s notify, body and cite options', () => {
		expect(run_ship_next.resume_of(args)).toStrictEqual({
			title: args.title,
			flags: [...NOTIFY, ...BODY, ...CITE],
			is_review: true,
		})
	})

	it('quotes only the tokens the shell would split or expand', () => {
		const step = run_ship_next.next_step(ISSUE, STAGE.PREFLIGHT, run_ship_next.resume_of(args))

		expect(step).toContain(`${NOTIFY[0] ?? ''} '${NOTIFY[1] ?? ''}' ${BODY.join(' ')}`)
	})
})

describe('run_ship_next.quoted', () => {
	it('single-quotes a title so the shell expands nothing in it', () => {
		expect(run_ship_next.quoted('Fix `$HOME` #1')).toBe("'Fix `$HOME` #1'")
	})

	it('escapes a single quote inside the title', () => {
		expect(run_ship_next.quoted("Don't #1")).toBe(String.raw`'Don'\''t #1'`)
	})
})
