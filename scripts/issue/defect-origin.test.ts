import { describe, expect, it } from 'vitest'
import { defect_origin } from './defect-origin'

const FIELD = '\u{1F}'
const RECORD = '\u{1E}'
const NEWER_AT = '2026-10-20T10:00:00+07:00'
const OLDER_AT = '2026-10-19T09:00:00+07:00'
const NEWER_TITLE = 'Draw the board #4190'
const OLDER_TITLE = 'Older #4100'
const FILED_AT = '2026-10-20T00:00:00Z'
const BOARD_COMMAND = 'run:board'
const BOARD_FILE = 'run-board.ts'
const IDENTIFIER = 'read_local'

function record(merged_at: string, pr: number, title: string): string {
	return `${merged_at}${FIELD}Merge pull request #${String(pr)} from joshuafolkken/x-lane${FIELD}${title}\n\nbody${RECORD}\n`
}

describe('defect:origin merge log', () => {
	it('reads each merge commit into its pull request, date and title', () => {
		const output = `${record(NEWER_AT, 4201, NEWER_TITLE)}${record(OLDER_AT, 4150, OLDER_TITLE)}`

		expect(defect_origin.parse_merges(output)).toEqual([
			{ pr: 4201, merged_at: NEWER_AT, title: NEWER_TITLE },
			{ pr: 4150, merged_at: OLDER_AT, title: OLDER_TITLE },
		])
	})

	it('skips a merge that is not a pull request merge', () => {
		const output = `${NEWER_AT}${FIELD}Merge branch 'main'${FIELD}${RECORD}`

		expect(defect_origin.parse_merges(output)).toEqual([])
	})

	it('bounds the log by the filing time and looks a path up by pathspec, a name by -S', () => {
		const pickaxe = defect_origin.pickaxe_arguments(IDENTIFIER)

		expect(defect_origin.path_arguments(BOARD_FILE, FILED_AT)).toEqual(
			expect.arrayContaining([
				'--first-parent',
				'--merges',
				`--before=${FILED_AT}`,
				'--',
				`:(glob)**/${BOARD_FILE}`,
			]),
		)
		expect(pickaxe).toContain(`-S${IDENTIFIER}`)
		expect(pickaxe.join(' ')).not.toContain('--before')
	})
})

describe('defect:origin introducing merge log', () => {
	it('reads every merge that added a path, unlimited and bounded by the filing time', () => {
		const introduced = defect_origin.introduced_arguments(BOARD_FILE, FILED_AT)

		expect(introduced).toEqual(
			expect.arrayContaining([
				'--merges',
				'--diff-filter=A',
				`--before=${FILED_AT}`,
				`:(glob)**/${BOARD_FILE}`,
			]),
		)
		expect(introduced.join(' ')).not.toContain('--max-count')
	})
})

const older = { pr: 4100, merged_at: '2026-10-01T00:00:00Z', title: 'Older' }
const newer = { pr: 4201, merged_at: FILED_AT, title: 'Newer' }

describe('defect:origin ranking', () => {
	it('lists the pull requests newest first, naming every target each one changed', () => {
		const ranked = defect_origin.rank([
			{ target: BOARD_COMMAND, merges: [older, newer] },
			{ target: BOARD_FILE, merges: [newer] },
		])

		expect(ranked.map((candidate) => [candidate.pr, candidate.targets])).toEqual([
			[4201, [BOARD_COMMAND, BOARD_FILE]],
			[4100, [BOARD_COMMAND]],
		])
	})

	it('ranks a pull request that hit two targets above a newer one that hit one', () => {
		const ranked = defect_origin.rank([
			{ target: BOARD_COMMAND, merges: [newer, older] },
			{ target: BOARD_FILE, merges: [older] },
		])

		expect(ranked.map(({ pr }) => pr)).toEqual([4100, 4201])
	})
})

describe('defect:origin introduced mark', () => {
	it('marks the pull request that first added a path, once, and keeps it past the cap', () => {
		const merges = Array.from({ length: 5 }, (_value, index) => ({
			pr: 4300 + index,
			merged_at: `2026-10-1${String(index)}T00:00:00Z`,
			title: 't',
		}))
		const first = defect_origin.rank([{ target: BOARD_FILE, merges, introduced: older }])
		const changed_and_added = defect_origin.rank([
			{ target: BOARD_FILE, merges: [newer], introduced: newer },
		])

		expect(first.at(-1)).toMatchObject({ pr: 4100, introduced: [BOARD_FILE] })
		expect(first).toHaveLength(6)
		expect(changed_and_added).toEqual([
			{ ...newer, targets: [BOARD_FILE], introduced: [BOARD_FILE] },
		])
	})

	it('keeps at most five candidates', () => {
		const merges = Array.from({ length: 7 }, (_value, index) => ({
			pr: index,
			merged_at: `2026-10-0${String(index + 1)}T00:00:00Z`,
			title: 't',
		}))

		expect(defect_origin.rank([{ target: 'a.ts', merges }]).map(({ pr }) => pr)).toEqual([
			6, 5, 4, 3, 2,
		])
	})
})

describe('defect:origin listing', () => {
	it('prints the candidates, or says none was found', () => {
		const printed = defect_origin.format(
			'4241',
			defect_origin.rank([{ target: 'a.ts', merges: [newer] }]),
		)

		expect(printed).toContain('#4201  2026-10-20  Newer\n  changed: a.ts')
		expect(printed).not.toContain('introduced:')
		expect(printed).toContain('(most targets first, then newest; declare one as `- 原因: #<PR>`)')
		expect(
			defect_origin.format(
				'4241',
				defect_origin.rank([{ target: 'a.ts', merges: [], introduced: older }]),
			),
		).toContain('#4100  2026-10-01  Older\n  changed: a.ts\n  introduced: a.ts')
		expect(defect_origin.format('4241', [])).toContain('no merged pull request')
	})
})
