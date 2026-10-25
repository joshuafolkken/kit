import { run_ship_review } from '#scripts/run/ship/run-ship-review'
import { time_markers } from '#scripts/time-runtime/time-markers'
import { describe, expect, it } from 'vitest'
import { GATE_GREEN, GATE_MOVED, GATE_RED, GATE_RUNNING, run_review } from './run-review'
import { run_review_cli } from './run-review-cli'

// joshuafolkken/kit#2179: the CLI seam — that `--join` turns a red gate into a non-zero exit, which is
// the mechanical form of "a review is not adopted over a red gate", and that the argument grammar is
// the two words it accepts and nothing else.

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1

describe('join_exit_code', () => {
	it('exits zero on a green gate, so the review verdict may be adopted', () => {
		expect(run_review_cli.join_exit_code(GATE_GREEN)).toBe(SUCCESS_EXIT_CODE)
	})

	it('exits non-zero on a red gate, blocking the review verdict', () => {
		expect(run_review_cli.join_exit_code(GATE_RED)).toBe(FAILURE_EXIT_CODE)
	})

	it('exits non-zero on a gate that never settled, rather than adopting over it', () => {
		expect(run_review_cli.join_exit_code(GATE_RUNNING)).toBe(FAILURE_EXIT_CODE)
	})

	it('exits with its own code on a gate that passed before the tree moved', () => {
		expect(run_review_cli.join_exit_code(GATE_MOVED)).toBe(run_review.MOVED_EXIT_CODE)
		expect(run_review.MOVED_EXIT_CODE).not.toBe(FAILURE_EXIT_CODE)
	})
})

// joshuafolkken/kit#4715: a `general-purpose` review agent loaded the skill, which forked a second one.
describe('JOIN_HINT', () => {
	it('names the reviewer agent type, which opens no nested review agent', () => {
		expect(run_review_cli.JOIN_HINT).toContain('as the `reviewer` agent type')
	})

	// joshuafolkken/kit#4863: the briefs are written to files, so the hints point the reviewer at them.
	it('hands the reviewer the brief file, as the interaction hint hands one per brief', () => {
		expect(run_review_cli.JOIN_HINT).toContain('brief file')
		expect(run_review_cli.INTERACTION_HINT).toContain('brief files')
		expect(run_review_cli.JOIN_HINT).toContain('with the prompt printed under its brief file')
		expect(run_review_cli.INTERACTION_HINT).toContain('each with its own printed prompt')
	})

	// joshuafolkken/kit#4863: the brief travels by path, so the review phase is read off the prompt.
	it('prints a launch prompt the review-phase timer reads as a review', () => {
		const prompt = run_ship_review.round_one_opening('/briefs/brief.md')

		expect(time_markers.tool_marker('Agent', { prompt })).toBe(time_markers.REVIEW_MARKER)
	})
})

describe('run argument grammar', () => {
	it('refuses an unknown flag with the usage line', async () => {
		expect(await run_review_cli.run(['--nope'])).toBe(FAILURE_EXIT_CODE)
	})

	it('refuses a second argument beside --join', async () => {
		expect(await run_review_cli.run(['--join', 'extra'])).toBe(FAILURE_EXIT_CODE)
	})
})
