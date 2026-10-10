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
