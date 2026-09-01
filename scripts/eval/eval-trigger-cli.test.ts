import { afterEach, describe, expect, it, vi } from 'vitest'
import { eval_stamp, type EvalStamp } from './eval-stamp'
import {
	STAMP_DOCUMENT,
	STAMP_HASH,
	stamp_of,
	STAMP_OTHER_HASH,
	STAMP_STARTED_AT,
} from './eval-stamp-fixture'
import { eval_trigger } from './eval-trigger'
import { eval_trigger_cli } from './eval-trigger-cli'

// joshuafolkken/kit#1152: `josh eval` starts when `/code-review` starts, so the verdict it returns
// describes the tree as it stood at that moment. `--since-eval` is the mechanical answer to whether
// the review then moved it — the one thing that decides between reporting that verdict and paying
// for another run.

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1

function given(stamp: EvalStamp | undefined, tree: Record<string, string> | undefined): void {
	vi.spyOn(eval_stamp, 'read_stamp').mockReturnValue(stamp)
	vi.spyOn(eval_stamp, 'try_read_tree').mockReturnValue(tree)
}

function silence_output(): void {
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe('eval_trigger_cli.since_eval_decision', () => {
	// The common case: a review that lands no high/medium finding edits nothing, so the concurrent
	// verdict is a reading of the tree that is still on disk.
	it('skips when the review changed nothing the scenarios read', () => {
		const files = { [STAMP_DOCUMENT]: STAMP_HASH }

		given(stamp_of(files), { ...files })

		expect(eval_trigger_cli.since_eval_decision().scope).toBe(eval_trigger.SKIPPED_SCOPE)
	})

	// The case the whole design turns on: the concurrent result now describes a tree that no longer
	// exists, so it must not be reported and the suite runs again.
	it('requires another run when the review edited a measured path', () => {
		given(stamp_of({ [STAMP_DOCUMENT]: STAMP_HASH }), { [STAMP_DOCUMENT]: STAMP_OTHER_HASH })

		const { scope, reason } = eval_trigger_cli.since_eval_decision()

		expect(scope).toBe(eval_trigger.REQUIRED_SCOPE)
		expect(reason).toContain(STAMP_DOCUMENT)
	})

	// "There is no record" is not "nothing changed". Answering `skip` here would hand a caller that
	// never measured the same answer as one that did — the trap `scope_for`'s empty case avoids too.
	it('requires a run when no record of a run exists', () => {
		given(undefined, { [STAMP_DOCUMENT]: STAMP_HASH })

		const { scope, reason } = eval_trigger_cli.since_eval_decision()

		expect(scope).toBe(eval_trigger.REQUIRED_SCOPE)
		expect(reason).toBe(eval_trigger_cli.NO_STAMP_REASON)
	})

	// The review applying its own fixes can delete or rename a measured file while this runs, which
	// is the situation the concurrency creates rather than an exotic one. Answering `required` keeps
	// the failure in the same direction as every other unreadable input.
	it('requires a run when the measured paths will not read', () => {
		given(stamp_of({ [STAMP_DOCUMENT]: STAMP_HASH }), undefined)

		const { scope, reason } = eval_trigger_cli.since_eval_decision()

		expect(scope).toBe(eval_trigger.REQUIRED_SCOPE)
		expect(reason).toBe(eval_trigger_cli.UNREADABLE_TREE_REASON)
	})

	// `josh eval` rewrites the record when it starts, so the time is how a reader sees that an
	// answer is about a run whose verdict they are not holding.
	it('names when the recorded run started', () => {
		const files = { [STAMP_DOCUMENT]: STAMP_HASH }

		given(stamp_of(files), { ...files })

		expect(eval_trigger_cli.since_eval_decision().reason).toContain(STAMP_STARTED_AT)
	})
})

describe('eval_trigger_cli.run_since_eval', () => {
	it('puts the scope on stdout and the reason on stderr', () => {
		const files = { [STAMP_DOCUMENT]: STAMP_HASH }
		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

		given(stamp_of(files), { ...files })

		expect(eval_trigger_cli.run_since_eval([eval_trigger_cli.SINCE_EVAL_FLAG])).toBe(
			SUCCESS_EXIT_CODE,
		)
		expect(info).toHaveBeenCalledWith(eval_trigger.SKIPPED_SCOPE)
		expect(error).toHaveBeenCalledWith(expect.stringContaining(STAMP_STARTED_AT))
	})

	// Two different questions — one of the index, one of a recorded run — asked in one invocation is
	// refused rather than resolved in the command's favour.
	it.each(['--staged', '--nonsense'])('refuses %s alongside it', (argument) => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

		expect(eval_trigger_cli.run_since_eval([eval_trigger_cli.SINCE_EVAL_FLAG, argument])).toBe(
			FAILURE_EXIT_CODE,
		)
		expect(error).toHaveBeenCalledWith(eval_trigger_cli.USAGE)
	})
})

describe('eval_trigger_cli.run', () => {
	it('routes the flag to the recorded-run question rather than the diff', async () => {
		const files = { [STAMP_DOCUMENT]: STAMP_HASH }
		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		vi.spyOn(console, 'error').mockImplementation(() => undefined)
		given(stamp_of(files), { ...files })

		await expect(eval_trigger_cli.run([eval_trigger_cli.SINCE_EVAL_FLAG, '--json'])).resolves.toBe(
			SUCCESS_EXIT_CODE,
		)
		expect(info).toHaveBeenCalledWith(expect.stringContaining(`"${eval_trigger_cli.JSON_KEY}"`))
	})

	// The record is only consulted for the flag that asks about it: the branch reading has to keep
	// answering from the diff even while a record sits in the temp directory.
	it('leaves the branch reading asking the diff', async () => {
		const read_stamp = vi.spyOn(eval_stamp, 'read_stamp')

		silence_output()

		await eval_trigger_cli.run([])

		expect(read_stamp).not.toHaveBeenCalled()
	})

	it('names both readings in its usage line', () => {
		expect(eval_trigger_cli.USAGE).toContain(eval_trigger_cli.SINCE_EVAL_FLAG)
	})
})
