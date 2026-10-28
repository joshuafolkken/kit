import { change_base } from '#scripts/git/change-base'
import { git_command } from '#scripts/git/git-command'
import { afterEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { review_code_tree } from './review-code-tree'
import { review_reviewed_tree } from './review-reviewed-tree'
import { review_round_one_closure, type Closure } from './review-round-one-closure'
import { review_round2 } from './review-round2'
import { review_round2_cli } from './review-round2-cli'
import { review_round2_skip_comment } from './review-round2-skip-comment'
import { review_stamps } from './review-stamps'
import { review_tree } from './review-tree'

// joshuafolkken/kit#1433. The parser is where a `skip` could be bought by accident, so it is the
// half with a suite of its own: anything it does not know is a usage error rather than a
// silently-defaulted answer. joshuafolkken/kit#5286: round 1's closure is no longer asserted.

describe('review_round2_cli.parse_options', () => {
	const { RECORD_FLAG } = review_round2_cli

	it('defaults to no issue and plain output', () => {
		expect(review_round2_cli.parse_options([])).toStrictEqual({
			is_json: false,
			record: undefined,
		})
	})

	it('reads the issue --record names', () => {
		expect(review_round2_cli.parse_options([RECORD_FLAG, '5286'])).toStrictEqual({
			is_json: false,
			record: 5286,
		})
	})

	it('reads the two flags together in either order', () => {
		const options = { is_json: true, record: 12 }

		expect(review_round2_cli.parse_options(['--json', RECORD_FLAG, '12'])).toStrictEqual(options)
	})

	it.each([[[RECORD_FLAG]], [[RECORD_FLAG, '0']], [[RECORD_FLAG, '--json']]])(
		'refuses --record without an issue number: %j',
		(argv) => {
			expect(review_round2_cli.parse_options(argv)).toBeUndefined()
		},
	)

	it('refuses the retired round-1 assertion flag', () => {
		expect(review_round2_cli.parse_options([review_round2_cli.RETIRED_CLOSED_FLAG])).toBeUndefined()
	})

	it('refuses an unknown flag', () => {
		expect(review_round2_cli.parse_options(['--staged'])).toBeUndefined()
	})

	it('refuses a bare argument', () => {
		expect(review_round2_cli.parse_options(['2'])).toBeUndefined()
	})
})

const SOURCE = 'scripts/review/review-round2.ts'
const BASE = '0123456789abcdef0123456789abcdef01234567'

function plant_record(digest: string): void {
	vi.spyOn(review_stamps.round_one_code_stamp, 'read').mockReturnValue({
		taken_at: '',
		files: { [SOURCE]: digest },
		base: BASE,
	})
}

async function plant_unmoved_record(cited: ReadonlyArray<string>): Promise<void> {
	const current = await review_code_tree.read([SOURCE])

	plant_record(current[SOURCE] ?? '')
	vi.spyOn(review_reviewed_tree, 'high_cited').mockReturnValue(cited)
}

// joshuafolkken/kit#3826: the code record is re-read against this checkout's own files, so a file
// whose comment-free digest still matches is named comment-only and one whose digest moved is not.
describe('review_round2_cli.read_comment_only', () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('names a file whose code is as the record took it', async () => {
		await plant_unmoved_record([])

		expect(await review_round2_cli.read_comment_only(BASE)).toStrictEqual([SOURCE])
	})

	// joshuafolkken/kit#4941: the ship reuses round 1 on the High's fix, so round 2 must read it.
	it('never names a file a recorded High cites, whose fix may be comments alone', async () => {
		await plant_unmoved_record([SOURCE])

		expect(await review_round2_cli.read_comment_only(BASE)).toStrictEqual([])
	})

	it('names nothing when the code moved since the record', async () => {
		plant_record('an-older-digest')

		expect(await review_round2_cli.read_comment_only(BASE)).toStrictEqual([])
	})
})

const OPEN: Closure = { is_closed: false, reason: 'round 1 left a Medium open' }
const BRANCH_ISSUE = 77

interface PlantedDecision {
	decide: MockInstance<typeof review_round2.decide>
	read: MockInstance<typeof review_round_one_closure.read>
}

// Every input `decide_here` reads, planted so the run decides from the closure given alone.
function plant_decision(closure: Closure): PlantedDecision {
	vi.spyOn(change_base, 'resolved_through_merge').mockResolvedValue(BASE)
	vi.spyOn(review_tree, 'read_changed_tree').mockResolvedValue({})
	vi.spyOn(review_stamps.round_one_stamp, 'read').mockReturnValue(undefined)
	vi.spyOn(review_stamps.round_one_code_stamp, 'read').mockReturnValue(undefined)
	vi.spyOn(git_command, 'branch').mockResolvedValue(`${String(BRANCH_ISSUE)}-lane`)
	vi.spyOn(console, 'info').mockReturnValue()
	vi.spyOn(console, 'error').mockReturnValue()

	return {
		decide: vi.spyOn(review_round2, 'decide'),
		read: vi.spyOn(review_round_one_closure, 'read').mockResolvedValue(closure),
	}
}

describe('review_round2_cli.run', () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('exits non-zero on an unreadable invocation', async () => {
		expect(await review_round2_cli.run(['--nope'])).toBe(1)
	})

	it('refuses the retired round-1 assertion with the line naming what replaced it', async () => {
		const error = vi.spyOn(console, 'error').mockReturnValue()

		expect(await review_round2_cli.run([review_round2_cli.RETIRED_CLOSED_FLAG])).toBe(1)
		expect(error).toHaveBeenCalledWith(review_round2_cli.RETIRED_CLOSED_LINE)
	})

	// joshuafolkken/kit#5307: the changed tree is read through a merge in progress, so the base it is
	// compared from has to be as well, or a re-merged default branch hides behind an unmoved base.
	it('decides from the base read through a merge in progress', async () => {
		const { decide } = plant_decision(OPEN)

		await review_round2_cli.run([])

		expect(decide).toHaveBeenCalledWith(expect.objectContaining({ base: BASE }))
	})
})

// joshuafolkken/kit#5286: round 1's closure is read from the ledger, for --record's issue or the
// branch's, and a skip is recorded on --record's issue alone.
describe('review_round2_cli.run — round 1 closure from the ledger', () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('decides from the ledger closure of the issue --record names', async () => {
		const { decide, read } = plant_decision(OPEN)

		vi.spyOn(review_round2_skip_comment, 'record').mockResolvedValue('not-skipped')
		await review_round2_cli.run([review_round2_cli.RECORD_FLAG, '12'])

		expect(read).toHaveBeenCalledWith(12)
		expect(decide).toHaveBeenCalledWith(
			expect.objectContaining({ is_round_one_closed: false, open_reason: OPEN.reason }),
		)
	})

	it('reads the closure of the branch issue when --record is absent', async () => {
		const { read } = plant_decision(OPEN)

		await review_round2_cli.run([])

		expect(read).toHaveBeenCalledWith(BRANCH_ISSUE)
	})

	it('records the answer on the issue --record names, and only then', async () => {
		plant_decision({ is_closed: true, reason: '' })
		const record = vi.spyOn(review_round2_skip_comment, 'record').mockResolvedValue('posted')

		await review_round2_cli.run([])
		expect(record).not.toHaveBeenCalled()

		await review_round2_cli.run([review_round2_cli.RECORD_FLAG, '12'])
		expect(record).toHaveBeenCalledWith(12, expect.objectContaining({ verdict: 'required' }))
	})
})

// joshuafolkken/kit#4064: `--json` carries the reason code; the plain answer stays the bare verdict.
describe('review_round2_cli.print', () => {
	const ANSWER = { verdict: 'skip', code: 'empty', reason: 'why' } as const

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('prints the verdict, the code and the reason as one JSON object under --json', () => {
		const info = vi.spyOn(console, 'info').mockReturnValue(undefined)

		review_round2_cli.print(ANSWER, true)

		expect(info).toHaveBeenCalledWith('{"round2":"skip","code":"empty","reason":"why"}')
	})

	it('prints the bare verdict on stdout and the reason on stderr otherwise', () => {
		const info = vi.spyOn(console, 'info').mockReturnValue(undefined)
		const error = vi.spyOn(console, 'error').mockReturnValue(undefined)

		review_round2_cli.print(ANSWER, false)

		expect(info).toHaveBeenCalledWith('skip')
		expect(error).toHaveBeenCalledWith('why')
	})
})
