import { describe, expect, it } from 'vitest'
import { run_cut_args } from './run-cut-args'

// joshuafolkken/kit#2354: `--handoff <path>` carries the run's instruction across a cut. These pin that
// it reaches the cut request as a path, that it pairs with a phase flag, and that pairing it with a
// mode that asks about a cut rather than takes one is refused.

const ISSUE = '2354'
const HANDOFF_PATH = 'run/handoff.json'

function request_for(argv: ReadonlyArray<string>): ReturnType<typeof run_cut_args.to_request> {
	const parsed = run_cut_args.read_arguments(argv)
	if (parsed === undefined) return undefined

	return run_cut_args.to_request(parsed)
}

// joshuafolkken/kit#7821: the no-diff investigation close carries its deliverable comment.
describe('the --deliverable url on a cut', () => {
	const FLAG = '--deliverable'

	it('reaches a pre-gate cut with its --deliverable url, refused beside --resume', () => {
		const deliverable = [FLAG, 'https://github.com/joshuafolkken/kit/issues/7780#c1']

		expect(request_for([ISSUE, ...deliverable])).toMatchObject({
			kind: 'cut',
			is_implementation: false,
			deliverable_url: deliverable[1],
		})
		expect(request_for(['--resume', ISSUE, ...deliverable])).toBeUndefined()
	})

	it('names --deliverable in the usage line', () => {
		expect(run_cut_args.USAGE).toContain('[--deliverable <comment-url>]')
	})

	it('refuses an empty --deliverable value', () => {
		expect(request_for([ISSUE, FLAG, ''])).toBeUndefined()
		expect(request_for([ISSUE, FLAG, ' '])).toBeUndefined()
	})
})

describe('the --handoff path on a cut', () => {
	it('reaches an implementation cut as a path', () => {
		expect(request_for(['--impl', ISSUE, '--handoff', HANDOFF_PATH])).toStrictEqual({
			kind: 'cut',
			issue: ISSUE,
			is_implementation: true,
			handoff_path: HANDOFF_PATH,
			deliverable_url: undefined,
		})
	})

	// joshuafolkken/kit#2489: the setup-phase cut is retired, so its flag is refused rather than read as
	// a bare pre-gate cut.
	it('refuses the retired --setup flag', () => {
		expect(request_for(['--setup', ISSUE, '--handoff', HANDOFF_PATH])).toBeUndefined()
	})

	it('reaches a bare pre-gate cut as a path', () => {
		expect(request_for([ISSUE, '--handoff', HANDOFF_PATH])).toMatchObject({
			kind: 'cut',
			handoff_path: HANDOFF_PATH,
		})
	})

	it('is refused alongside a mode that asks about a cut', () => {
		expect(request_for(['--resume', ISSUE, '--handoff', HANDOFF_PATH])).toBeUndefined()
	})
})
