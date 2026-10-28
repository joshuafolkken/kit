import { beforeEach, describe, expect, it, vi } from 'vitest'

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
const FAILED = 1
const INTERACTION_FLAG = '--interaction'
const NONE_FLAG = '--none'

beforeEach(() => {
	stamps.clear()
	vi.spyOn(console, 'info').mockReturnValue()
	vi.spyOn(console, 'error').mockReturnValue()
})

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
		expect(review_submit_cli.run([], 'bug-risks:critical:a.ts')).toBe(FAILED)

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

	it.each([[['--code']], [[INTERACTION_FLAG, 'extra']], [[NONE_FLAG, NONE_FLAG]]])(
		'refuses the arguments %j',
		(argv) => {
			expect(review_submit_cli.run(argv, MEDIUM)).toBe(FAILED)

			expect(stamps.size).toBe(0)
			expect(console.error).toHaveBeenCalledWith(review_submit_cli.USAGE)
		},
	)
})
