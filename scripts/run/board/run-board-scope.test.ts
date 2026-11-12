import { describe, expect, it } from 'vitest'
import { run_board_scope } from './run-board-scope'

// joshuafolkken/kit#3442: the board's plan is the run's own, read off the carry record's invocation.

describe('run_board_scope.scope_of', () => {
	it('names the one issue of a single --only run', () => {
		expect(run_board_scope.scope_of('backlogrun #3441 --only')).toStrictEqual({
			issues: [3441],
			only: true,
		})
	})

	it('names the epic of an epic --only run, whose children the plan expands', () => {
		expect(run_board_scope.scope_of('backlogrun #3406 --only')).toStrictEqual({
			issues: [3406],
			only: true,
		})
	})

	it('names every issue of a named run without --only, in the declared order', () => {
		expect(run_board_scope.scope_of('backlogrun #3442 #3430')).toStrictEqual({
			issues: [3442, 3430],
			only: false,
		})
	})

	it('names nothing for a bare backlogrun', () => {
		expect(run_board_scope.scope_of('backlogrun')).toStrictEqual({ issues: [], only: false })
	})

	it('names nothing for an invocation that does not parse', () => {
		expect(run_board_scope.scope_of('backlogrun 3441 --bogus')).toStrictEqual({
			issues: [],
			only: false,
		})
	})
})

// joshuafolkken/kit#6836: the board drew none of the issues `run:add` handed an --only run.
describe('run_board_scope.scope_of added issues', () => {
	it('joins the added issues in the driver’s order: prioritized, declared, appended, each once', () => {
		const added = [
			{ issue: 6812, is_priority: true },
			{ issue: 3442, is_priority: true },
			{ issue: 6787, is_priority: false },
		]

		expect(run_board_scope.scope_of('backlogrun #3442 #3430 --only', added)).toStrictEqual({
			issues: [6812, 3442, 3430, 6787],
			only: true,
		})
	})

	it('keeps a single fullrun to its own issue whatever the record added', () => {
		expect(
			run_board_scope.scope_of('fullrun #12', [{ issue: 6812, is_priority: true }]),
		).toStrictEqual({ issues: [12], only: true })
	})
})
