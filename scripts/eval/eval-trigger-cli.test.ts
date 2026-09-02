import { path_decision } from '#scripts/josh/path-decision'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { eval_stamp, type EvalStamp } from './eval-stamp'
import {
	STAMP_DOCUMENT,
	STAMP_HASH,
	stamp_of,
	STAMP_OTHER_HASH,
	STAMP_STARTED_AT,
} from './eval-stamp-fixture'
import { eval_switch } from './eval-switch'
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

// joshuafolkken/kit#1235 made the measurement opt-in, so every reading that is about the *paths*
// has to say which side of the switch it is on. Spying rather than stubbing the variable keeps these
// tests independent of whatever the machine running them happens to export.
function given_measurement(is_enabled: boolean): void {
	vi.spyOn(eval_switch, 'is_enabled').mockReturnValue(is_enabled)
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

		given_measurement(true)
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
		given_measurement(true)
		given(stamp_of(files), { ...files })

		await expect(eval_trigger_cli.run([eval_trigger_cli.SINCE_EVAL_FLAG, '--json'])).resolves.toBe(
			SUCCESS_EXIT_CODE,
		)
		expect(info).toHaveBeenCalledWith(expect.stringContaining(`"${eval_trigger_cli.JSON_KEY}"`))
	})

	// The record is only consulted for the flag that asks about it: the branch reading keeps going to
	// the shared path decision, which is what reads the diff. Delegation is asserted rather than run,
	// because running it shells out to `git diff main` — a revision a shallow CI checkout does not
	// have, which is a statement about the checkout rather than about this command.
	it('leaves the branch reading to the shared path decision', async () => {
		const delegated = vi
			.spyOn(path_decision, 'run_path_decision')
			.mockResolvedValue(SUCCESS_EXIT_CODE)
		const read_stamp = vi.spyOn(eval_stamp, 'read_stamp')

		await eval_trigger_cli.run([])

		expect(delegated).toHaveBeenCalledTimes(1)
		expect(read_stamp).not.toHaveBeenCalled()
	})

	it('keeps the recorded-run reading away from that same path decision', async () => {
		const files = { [STAMP_DOCUMENT]: STAMP_HASH }
		const delegated = vi
			.spyOn(path_decision, 'run_path_decision')
			.mockResolvedValue(SUCCESS_EXIT_CODE)

		silence_output()
		given(stamp_of(files), { ...files })

		await eval_trigger_cli.run([eval_trigger_cli.SINCE_EVAL_FLAG])

		expect(delegated).not.toHaveBeenCalled()
	})

	it('names both readings in its usage line', () => {
		expect(eval_trigger_cli.USAGE).toContain(eval_trigger_cli.SINCE_EVAL_FLAG)
	})
})

// joshuafolkken/kit#1235: the gate asks this command whether to spend five real Claude sessions, so
// turning the suite off is done here rather than by deleting the step from the procedures — the
// documents keep describing one gate, and the answer changes in one place.
const MEASURED_PATH = eval_trigger.MEASURED_PATHS[0] ?? 'CLAUDE.md'

describe('the opt-in switch, at the branch reading', () => {
	it('answers skip for a measured path while the measurement is off', () => {
		given_measurement(false)

		expect(eval_trigger_cli.decide_scope([MEASURED_PATH])).toBe(eval_trigger.SKIPPED_SCOPE)
	})

	// The switch suppresses the run; it does not rewrite what the paths mean. Turning it on has to
	// give back exactly the answer the trigger always gave.
	it('decides from the changed paths again once it is on', () => {
		given_measurement(true)

		expect(eval_trigger_cli.decide_scope([MEASURED_PATH])).toBe(eval_trigger.REQUIRED_SCOPE)
	})

	// A `skip` explained as "no changed path is one the scenarios can see" would describe a diff
	// nobody looked at, and send whoever chases it into the trigger set rather than to the switch.
	it('says the switch is why, not the diff', () => {
		given_measurement(false)

		expect(eval_trigger_cli.explain_scope([MEASURED_PATH], eval_trigger.SKIPPED_SCOPE)).toBe(
			eval_switch.DISABLED_REASON,
		)
	})

	it('leaves the path-based sentence in place once it is on', () => {
		given_measurement(true)

		expect(eval_trigger_cli.explain_scope([MEASURED_PATH], eval_trigger.REQUIRED_SCOPE)).toContain(
			MEASURED_PATH,
		)
	})
})

// The staleness reading is asked by the same gate, so a switch that only reached the branch reading
// would leave a run measuring again the moment a review touched a distributed document.
describe('the opt-in switch, at the recorded-run reading', () => {
	it('answers skip without consulting the record', () => {
		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
		const read_stamp = vi.spyOn(eval_stamp, 'read_stamp')

		given_measurement(false)

		expect(eval_trigger_cli.run_since_eval([eval_trigger_cli.SINCE_EVAL_FLAG])).toBe(
			SUCCESS_EXIT_CODE,
		)
		expect(info).toHaveBeenCalledWith(eval_trigger.SKIPPED_SCOPE)
		expect(error).toHaveBeenCalledWith(eval_switch.DISABLED_REASON)
		expect(read_stamp).not.toHaveBeenCalled()
	})

	// An invocation nobody can read must not be handed the same `skip` a correct one gets: the switch
	// silences the measurement, never the usage error.
	it('still refuses an unreadable invocation while off', () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

		given_measurement(false)

		expect(eval_trigger_cli.run_since_eval([eval_trigger_cli.SINCE_EVAL_FLAG, '--staged'])).toBe(
			FAILURE_EXIT_CODE,
		)
		expect(error).toHaveBeenCalledWith(eval_trigger_cli.USAGE)
	})
})
