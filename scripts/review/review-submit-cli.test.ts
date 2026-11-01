import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

// The stamp files live in memory, so the test never writes the findings file a real ship in this
// checkout reads.
const stamps = vi.hoisted(() => new Map<string, string>())

vi.mock('#scripts/josh/stamp-file', () => ({
	stamp_file: {
		read_stamp_text: (source: string) => stamps.get(source),
		remove_stamp: (target: string) => stamps.delete(target),
		stamp_path: (prefix: string, root: string, suffix: string) => `${root}/${prefix}${suffix}`,
		write_text_stamp: (target: string, text: string) => stamps.set(target, text),
	},
}))

const { review_submit_cli } = await import('./review-submit-cli')
const { run_ship_reviewer } = await import('#scripts/run/ship/run-ship-reviewer')

// joshuafolkken/kit#4799: the reviewer hands its findings to a command, which writes them where the
// supervisor reads them, so no path is copied out of a prompt.

const MEDIUM = 'bug-risks:medium:a.ts:3 — the count never trips'
const OFF_GRAMMAR = 'bug-risks:critical:a.ts'
const FAILED = 1
const INTERACTION_FLAG = '--interaction'
const NONE_FLAG = '--none'
const REVIEW_FLAG = '--review'
const ROUND_FLAG = '--round'
// The smallest review the rubric's format accepts, and one that breaks it.
const CONFORMING_REVIEW = 'REVIEW TARGET MISMATCH'
const SUMMARY_ONLY_REVIEW = '### Summary\n\ngo'

const REVIEW_DIRECTORY = mkdtempSync(path.join(tmpdir(), 'review-submit-'))

beforeEach(() => {
	stamps.clear()
	vi.spyOn(console, 'info').mockReturnValue()
	vi.spyOn(console, 'error').mockReturnValue()
})

afterAll(() => {
	rmSync(REVIEW_DIRECTORY, { recursive: true, force: true })
})

function review_file(markdown: string): string {
	const target = path.join(REVIEW_DIRECTORY, 'review.md')

	writeFileSync(target, markdown)

	return target
}

function error_output(): string {
	return vi
		.mocked(console.error)
		.mock.calls.map((call) => String(call[0]))
		.join('\n')
}

describe('review_submit_cli — the supervisor reads what it wrote', () => {
	it.each([
		['code', []],
		['interaction', [INTERACTION_FLAG]],
	] as const)('hands the %s slot its findings', (slot, argv) => {
		expect(review_submit_cli.run(argv, `${MEDIUM}\n`)).toBe(0)

		expect(run_ship_reviewer.current_verdict(slot)).toMatchObject({
			kind: 'blocking',
			specs: ['bug-risks:medium:a.ts:3'],
		})
	})

	it.each([
		['code', [NONE_FLAG]],
		['interaction', [INTERACTION_FLAG, NONE_FLAG]],
	] as const)('writes --none as a clean %s review', (slot, argv) => {
		expect(review_submit_cli.run(argv, '')).toBe(0)

		expect(run_ship_reviewer.current_verdict(slot)).toMatchObject({ kind: 'clean', specs: [] })
	})

	it('keeps each slot apart', () => {
		review_submit_cli.run([INTERACTION_FLAG], MEDIUM)

		expect(run_ship_reviewer.current_verdict('code')).toMatchObject({ kind: 'invalid' })
	})
})

describe('review_submit_cli — a refusal writes nothing', () => {
	it('refuses a line outside the review:record grammar', () => {
		expect(review_submit_cli.run([], OFF_GRAMMAR)).toBe(FAILED)

		expect(stamps.size).toBe(0)
		expect(console.error).toHaveBeenCalledWith(expect.stringContaining('nothing written'))
	})

	// An empty stdin is a forgotten pipe or a terminal as often as a clean review.
	it.each(['', '\n  \n'])('refuses empty stdin %j without --none', (findings) => {
		expect(review_submit_cli.run([], findings)).toBe(FAILED)

		expect(stamps.size).toBe(0)
		expect(console.error).toHaveBeenCalledWith(review_submit_cli.EMPTY_NOTE)
	})

	it('refuses --none passed with findings', () => {
		expect(review_submit_cli.run([NONE_FLAG], MEDIUM)).toBe(FAILED)

		expect(stamps.size).toBe(0)
	})

	it.each([
		[['--code']],
		[[INTERACTION_FLAG, 'extra']],
		[[NONE_FLAG, NONE_FLAG]],
		[[ROUND_FLAG, '2']],
		[[REVIEW_FLAG]],
		[[REVIEW_FLAG, 'review.md', ROUND_FLAG, '3']],
	])('refuses the arguments %j', (argv) => {
		expect(review_submit_cli.run(argv, MEDIUM)).toBe(FAILED)

		expect(stamps.size).toBe(0)
		expect(console.error).toHaveBeenCalledWith(review_submit_cli.USAGE)
	})
})

// joshuafolkken/kit#5627: the reviewer's markdown review is linted in the call that submits its
// findings, so a grammar refusal and a format violation cost one re-run, not one call each.
describe('review_submit_cli — --review lints the review in the same call', () => {
	it('writes the findings when the review conforms', () => {
		const argv = [REVIEW_FLAG, review_file(CONFORMING_REVIEW)]

		expect(review_submit_cli.run(argv, MEDIUM)).toBe(0)

		expect(run_ship_reviewer.current_verdict('code')).toMatchObject({ kind: 'blocking' })
	})

	it('writes a --none review when the review conforms', () => {
		const argv = [NONE_FLAG, REVIEW_FLAG, review_file(CONFORMING_REVIEW)]

		expect(review_submit_cli.run(argv, '')).toBe(0)

		expect(run_ship_reviewer.current_verdict('code')).toMatchObject({ kind: 'clean' })
	})

	it('returns the grammar refusal and the format violations together, writing nothing', () => {
		const argv = [REVIEW_FLAG, review_file(SUMMARY_ONLY_REVIEW)]

		expect(review_submit_cli.run(argv, OFF_GRAMMAR)).toBe(FAILED)

		expect(stamps.size).toBe(0)
		expect(console.error).toHaveBeenCalledOnce()
		expect(error_output()).toMatch(/nothing written — .*critical/u)
		expect(error_output()).toContain('✖ missing heading: ### Bug risks & logic errors')
	})

	it('refuses valid findings while the review breaks the round-2 shape', () => {
		const argv = [REVIEW_FLAG, review_file(SUMMARY_ONLY_REVIEW), ROUND_FLAG, '2']

		expect(review_submit_cli.run(argv, MEDIUM)).toBe(FAILED)

		expect(stamps.size).toBe(0)
		expect(error_output()).toContain('✖ missing heading: ### First-round findings')
	})

	it('refuses a review file it cannot read', () => {
		const argv = [REVIEW_FLAG, path.join(REVIEW_DIRECTORY, 'absent.md')]

		expect(review_submit_cli.run(argv, MEDIUM)).toBe(FAILED)

		expect(stamps.size).toBe(0)
		expect(error_output()).toContain('cannot read the review')
	})
})
