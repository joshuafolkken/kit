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

describe('the --handoff path on a cut', () => {
	it('reaches an implementation cut as a path', () => {
		expect(request_for(['--impl', ISSUE, '--handoff', HANDOFF_PATH])).toStrictEqual({
			kind: 'cut',
			issue: ISSUE,
			is_implementation: true,
			is_setup: false,
			handoff_path: HANDOFF_PATH,
		})
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
