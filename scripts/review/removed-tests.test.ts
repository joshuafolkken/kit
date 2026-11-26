import { describe, expect, it } from 'vitest'
import { removed_tests } from './removed-tests'
import { test_titles } from './test-titles'

// joshuafolkken/kit#4287: #4171 deleted `lane_thresholds()` with the tests that guarded it, and no
// gate, brief or review noticed. A test the base had and the change does not is listed and refused at
// the merge until the pull request body names what replaced it or the Issue that retired it.

const SHARE =
	'run_board_render_slot.usage_slot > shades a running row against the share of the frame’s running rows'
const LANES =
	'run_board_render_slot.usage_slot > shades the same usage by how many lanes are running'
const CPU =
	'run_board_usage_text.text_of — the CPU figure > shades the CPU figure against the CPU share'
const THRESHOLDS =
	'run_board_usage_text.lane_thresholds > divides the pool among the running lanes, and reads no lane as one'
const KEPT = 'run_board_usage_text.text_of > prints the figure'
// The #4171 change: every lane-share test gone, the one beside them kept.
const BASE_4171 = [SHARE, LANES, CPU, THRESHOLDS, KEPT]
const REMOVED_4171 = [SHARE, LANES, CPU, THRESHOLDS]
const COMMON_A = 'a > returns undefined'
const COMMON_B = 'b > returns undefined'
const SUMMARY = '## Summary'
const PENDING_THRESHOLDS = `- \`${THRESHOLDS}\` — 未記入`

function body_of(rows: ReadonlyArray<string>): string {
	return [SUMMARY, '', removed_tests.DISPOSITION_HEADING, '', ...rows, ''].join('\n')
}

describe('removed_tests.removed — the tests the change no longer has', () => {
	it('lists each test the base had that the change dropped, and none it kept', () => {
		expect(removed_tests.removed(BASE_4171, [KEPT])).toStrictEqual(REMOVED_4171)
	})

	it('reads a test moved under a renamed block, or to another file, as kept', () => {
		const head = [KEPT, `renamed block > ${test_titles.leaf_of(SHARE)}`, LANES, CPU, THRESHOLDS]

		expect(removed_tests.removed(BASE_4171, head)).toStrictEqual([])
	})

	it('still lists a common title deleted under one block while another keeps its own', () => {
		expect(removed_tests.removed([COMMON_A, COMMON_B], [COMMON_B])).toStrictEqual([COMMON_A])
	})

	it('spends one arrival on one departure, so a single move covers only one of two', () => {
		const head = ['c > returns undefined']

		expect(removed_tests.removed([COMMON_A, COMMON_B], head)).toStrictEqual([COMMON_B])
	})

	it('lists every test of a deleted file, since nothing in the change holds them', () => {
		expect(removed_tests.removed([SHARE, LANES], [])).toStrictEqual([SHARE, LANES])
	})
})

describe('removed_tests.undisposed — the #4171 deletion at the merge', () => {
	it('refuses every removed test when the body says nothing of them', () => {
		expect(removed_tests.undisposed(REMOVED_4171, SUMMARY)).toStrictEqual(REMOVED_4171)
		expect(removed_tests.undisposed(REMOVED_4171)).toStrictEqual(REMOVED_4171)
	})

	it('passes once each is replaced by a named test or retired by an Issue', () => {
		const body = body_of([
			`- \`${SHARE}\` — 置き換え: run_board_bar > shades a bar by the lane share`,
			`- \`${LANES}\` — 置き換え: run_board_bar > shades a bar by the lane count`,
			`- \`${CPU}\` — 廃止: #4171 the CPU figure is a bar now`,
			`- \`${THRESHOLDS}\` — 廃止: joshuafolkken/kit#4171 thresholds moved into the bar`,
		])

		expect(removed_tests.undisposed(REMOVED_4171, body)).toStrictEqual([])
	})

	it('passes a disposed title that holds backticks of its own', () => {
		const title = 'test_titles > reads the case table of `.each` as no title'
		const body = body_of([`- \`${title}\` — 置き換え: test_titles > reads a modified call`])

		expect(removed_tests.undisposed([title], body)).toStrictEqual([])
	})

	it('still refuses a pending row, a retirement naming no Issue, and a row outside the section', () => {
		const body = [
			`- \`${THRESHOLDS}\` — 置き換え: above the section, so not read`,
			body_of([`- \`${SHARE}\` — 未記入`, `- \`${LANES}\` — 廃止: no longer needed`]),
		].join('\n')
		const titles = [SHARE, LANES, THRESHOLDS]

		expect(removed_tests.undisposed(titles, body)).toStrictEqual(titles)
	})
})

// joshuafolkken/kit#4563: the ship body draft carries a pending row for each removed test before the
// ship, and the row stays refused until the run fills it in.
describe('removed_tests.with_pending_rows — the rows a draft gets before the ship', () => {
	const HINT = `<!-- when the change removes or renames a test, ${removed_tests.ROW_FORMAT} -->`
	const PENDING_SHARE = `- \`${SHARE}\` — 未記入`

	it('adds the heading and a titled pending row to a body with no section, never at the hint', () => {
		const body = removed_tests.with_pending_rows(`${SUMMARY}\n\n${HINT}\n`, [THRESHOLDS])

		expect(body).toBe(
			`${SUMMARY}\n\n${HINT}\n\n${removed_tests.DISPOSITION_HEADING}\n\n${PENDING_THRESHOLDS}\n`,
		)
		expect(removed_tests.undisposed([THRESHOLDS], body)).toStrictEqual([THRESHOLDS])
	})

	it('puts a missing row under the heading the body already has, keeping its rows', () => {
		const filled = `- \`${CPU}\` — 廃止: #4171 the CPU figure is a bar now`
		const body = removed_tests.with_pending_rows(body_of([filled]), [SHARE])

		expect(removed_tests.undisposed([SHARE, CPU], body)).toStrictEqual([SHARE])
		expect(body).toContain(`${removed_tests.DISPOSITION_HEADING}\n\n${PENDING_SHARE}\n\n${filled}`)
	})

	it('leaves a body alone once each title has a row, pending or filled', () => {
		const body = body_of([PENDING_THRESHOLDS, `- \`${LANES}\` — 置き換え: run_board_bar > shades`])

		expect(removed_tests.with_pending_rows(body, [THRESHOLDS, LANES])).toBe(body)
	})
})

describe('removed_tests — what the brief and the refusal print', () => {
	it('adds no brief section when no test was removed', () => {
		expect(removed_tests.brief_block(removed_tests.NONE)).toStrictEqual([])
		expect(removed_tests.brief_block()).toStrictEqual([])
	})

	it('lists each removed test in the brief as a row to dispose of', () => {
		const block = removed_tests.brief_block({ removed: [THRESHOLDS], renamed: [] }).join('\n')

		expect(block).toContain('Removed tests')
		expect(block).toContain(PENDING_THRESHOLDS)
	})

	it('names each undisposed test in the refusal, under the section to write', () => {
		const message = removed_tests.refusal_message([THRESHOLDS])

		expect(message).toContain('Merge refused')
		expect(message).toContain(removed_tests.DISPOSITION_HEADING)
		expect(message).toContain(PENDING_THRESHOLDS)
		expect(message).toContain('PR 本文の消えたテストの処置')
	})
})

// joshuafolkken/kit#8927: 769 removed tests outgrew the pull request body one row each; a test file
// the change deleted whole is disposed of by one row naming it.
const GONE = 'scripts/board/run-board-usage-text.test.ts'
const FILES = [{ path: GONE, titles: [CPU, THRESHOLDS] }]

describe('removed_tests — the row of a test file deleted whole', () => {
	const FILE_ROW = `- \`${GONE}\` — 廃止: #4171 the usage text is a bar now`

	it('disposes of every test of the deleted file named by one row (ac-5e6ddb59)', () => {
		expect(removed_tests.undisposed(REMOVED_4171, body_of([FILE_ROW]), FILES)).toStrictEqual([
			SHARE,
			LANES,
		])
	})

	it('still reads a per-test row; a kept file’s row disposes of nothing (ac-30790fde)', () => {
		const kept_row = `- \`scripts/board/run-board-render-slot.test.ts\` — 廃止: #4171 gone`
		const body = body_of([kept_row, `- \`${SHARE}\` — 置き換え: run_board_bar > shades`])

		expect(removed_tests.undisposed(REMOVED_4171, body, FILES)).toStrictEqual([
			LANES,
			CPU,
			THRESHOLDS,
		])
	})

	it('writes one pending row for the deleted file, in the draft, the brief and the refusal', () => {
		const pending = `- \`${GONE}\` — 未記入`
		const draft = removed_tests.with_pending_rows(SUMMARY, REMOVED_4171, {
			renamed: [],
			files: FILES,
		})
		const brief = removed_tests.brief_block({ removed: REMOVED_4171, renamed: [], files: FILES })
		const refusal = removed_tests.refusal_message([CPU, THRESHOLDS], { renamed: [], files: FILES })

		expect(draft).toContain(pending)
		expect(draft).not.toContain(PENDING_THRESHOLDS)
		expect(brief).toContain(pending)
		expect(refusal).toContain(pending)
		expect(refusal).not.toContain(PENDING_THRESHOLDS)
	})
})

describe('removed_tests — a test renamed out of a deleted file', () => {
	it('keeps its filled row beside the pending row of the file', () => {
		const context = { renamed: [{ from: THRESHOLDS, to: KEPT }], files: FILES }
		const draft = removed_tests.with_pending_rows(SUMMARY, [CPU, THRESHOLDS], context)

		expect(draft).toContain(`- \`${GONE}\` — 未記入`)
		expect(draft).toContain(`- \`${THRESHOLDS}\` — 置き換え: \`${KEPT}\``)
		expect(removed_tests.undisposed([CPU, THRESHOLDS], draft, FILES)).toStrictEqual([CPU])
	})
})

describe('removed_tests — hundreds of removed tests in one change', () => {
	const BODY_LIMIT = 65_536
	const FILE_COUNT = 104
	const TESTS_PER_FILE = 8
	const LONG = 'renders the frame of the theme module on the cell layer and plays its sound'

	function gone_files(): ReadonlyArray<{ path: string; titles: ReadonlyArray<string> }> {
		return Array.from({ length: FILE_COUNT }, (_file, file) => ({
			path: `src/lib/demos/theme-${String(file)}/theme-${String(file)}-module.test.ts`,
			titles: Array.from(
				{ length: TESTS_PER_FILE },
				(_test, test) => `theme_${String(file)}_module > case ${String(test)} ${LONG}`,
			),
		}))
	}

	it('fits a body disposing of 832 tests into the pull request body limit, and passes it', () => {
		const files = gone_files()
		const titles = files.flatMap((file) => file.titles)
		const draft = removed_tests.with_pending_rows(SUMMARY, titles, { renamed: [], files })
		const body = draft.replaceAll('— 未記入', '— 廃止: #8917 the cell layer replaced the old demos')

		expect(removed_tests.with_pending_rows(SUMMARY, titles).length).toBeGreaterThan(BODY_LIMIT)
		expect(body.length).toBeLessThan(BODY_LIMIT)
		expect(removed_tests.undisposed(titles, body, files)).toStrictEqual([])
	})
})

// joshuafolkken/kit#7883: a renamed test's replacement is known, so its row is written filled.
describe('removed_tests — the row of a renamed test', () => {
	const RENAMED = [{ from: THRESHOLDS, to: KEPT }]
	const FILLED = `- \`${THRESHOLDS}\` — 置き換え: \`${KEPT}\``

	it('writes the replacement row into a draft, which then disposes of the test', () => {
		const body = removed_tests.with_pending_rows(SUMMARY, [THRESHOLDS, LANES], {
			renamed: RENAMED,
		})

		expect(body).toContain(FILLED)
		expect(removed_tests.undisposed([THRESHOLDS, LANES], body)).toStrictEqual([LANES])
	})

	it('names the replacement row in the refusal of a body that lacks it', () => {
		const message = removed_tests.refusal_message([THRESHOLDS, LANES], { renamed: RENAMED })

		expect(message).toContain(FILLED)
		expect(message).toContain(`- \`${LANES}\` — 未記入`)
	})
})
