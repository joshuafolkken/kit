import { describe, expect, it } from 'vitest'
import { run_carry } from './run-carry'
import { run_carry_args } from './run-carry-args'

// Pins how `josh run:carry` turns `argv` into one request: each request group, each counting flag,
// the `--owner` and `--summary` checks, and every shape that is refused as a usage error.

const INVOCATION = 'backlogrun #2989'
const MERGED = '2'
const FILED = '3'
const ISSUE = '2989'
const REASON = 'needs a decision'
const SUMMARY = 'nothing to change'
const OWN_PID = String(process.pid)
const UNSAFE_ISSUE = '99999999999999999999'
const RETROSPECTIVE_FLAG = '--retrospective'
const SUMMARY_FLAG = '--summary'

function request_for(argv: ReadonlyArray<string>): ReturnType<typeof run_carry_args.to_request> {
	const parsed = run_carry_args.read_arguments(argv)
	if (parsed === undefined) return undefined

	return run_carry_args.to_request(parsed)
}

describe('run_carry_args.read_arguments', () => {
	it('answers the parsed values for known flags', () => {
		// `parseArgs` answers a null-prototype object, so the comparison is by value rather than strict.
		expect(run_carry_args.read_arguments(['--cut', '--merged', MERGED])).toEqual({
			cut: true,
			merged: MERGED,
		})
	})

	it('refuses an unknown flag', () => {
		expect(run_carry_args.read_arguments(['--unknown'])).toBeUndefined()
	})

	it('refuses a positional argument', () => {
		expect(run_carry_args.read_arguments(['stray'])).toBeUndefined()
	})

	it('refuses a string flag with no value', () => {
		expect(run_carry_args.read_arguments(['--merged'])).toBeUndefined()
	})

	it('names every request group in the usage line', () => {
		for (const flag of ['--json', '--begin', '--resume', '--cut', '--end', '--stopped']) {
			expect(run_carry_args.USAGE).toContain(flag)
		}
	})
})

describe('run_carry_args.to_request read and claim', () => {
	it('reads with no flags and with --json', () => {
		expect(request_for([])).toStrictEqual({ kind: 'read' })
		expect(request_for(['--json'])).toStrictEqual({ kind: 'read' })
	})

	it('ignores --stopped without --end', () => {
		expect(request_for(['--stopped', REASON])).toStrictEqual({ kind: 'read' })
	})

	it('claims a new run with --begin and no owner', () => {
		expect(request_for(['--begin', INVOCATION])).toStrictEqual({
			kind: 'claim',
			claim: { invocation: INVOCATION, owner: run_carry.NO_OWNER, is_adoption: false },
		})
	})

	it('adopts a run with --resume', () => {
		expect(request_for(['--resume', INVOCATION])).toStrictEqual({
			kind: 'claim',
			claim: { invocation: INVOCATION, owner: run_carry.NO_OWNER, is_adoption: true },
		})
	})

	it('carries the named owner on a claim', () => {
		expect(request_for(['--begin', INVOCATION, '--owner', OWN_PID])).toStrictEqual({
			kind: 'claim',
			claim: {
				invocation: INVOCATION,
				owner: run_carry.owner_of(process.pid),
				is_adoption: false,
			},
		})
	})

	it('refuses an empty invocation on --begin and --resume', () => {
		expect(request_for(['--begin', ''])).toBeUndefined()
		expect(request_for(['--resume', ''])).toBeUndefined()
	})
})

describe('run_carry_args.to_request invocation spelling', () => {
	const typed = 'backlogrun  #2989 --max 05'
	const canonical = 'backlogrun #2989 --max 5'
	const other_command = 'fullrun #2989'

	it('stores a backlogrun invocation in its canonical spelling on --begin and --resume', () => {
		expect(request_for(['--begin', typed])).toStrictEqual({
			kind: 'claim',
			claim: { invocation: canonical, owner: run_carry.NO_OWNER, is_adoption: false },
		})
		expect(request_for(['--resume', typed])).toStrictEqual({
			kind: 'claim',
			claim: { invocation: canonical, owner: run_carry.NO_OWNER, is_adoption: true },
		})
	})

	it('keeps an invocation the backlogrun grammar does not read as typed', () => {
		expect(request_for(['--begin', other_command])).toStrictEqual({
			kind: 'claim',
			claim: { invocation: other_command, owner: run_carry.NO_OWNER, is_adoption: false },
		})
	})
})

describe('run_carry_args.to_request end', () => {
	it('ends with and without a stop reason', () => {
		expect(request_for(['--end'])).toStrictEqual({ kind: 'end', stopped: undefined })
		expect(request_for(['--end', '--stopped', REASON])).toStrictEqual({
			kind: 'end',
			stopped: REASON,
		})
	})
})

describe('run_carry_args.to_request counting group', () => {
	it('counts a cut as one cut and nothing else', () => {
		expect(request_for(['--cut'])).toStrictEqual({
			kind: 'count',
			change: { merged: 0, filed: 0, cuts: 1 },
			owner: run_carry.NO_OWNER,
		})
	})

	// joshuafolkken/kit#3296: `--merged` names the issue, so the change is the one `run:merge` applies.
	it('counts a merged issue as one merge naming it, beside a filed amount', () => {
		expect(request_for(['--merged', ISSUE, '--filed', FILED])).toMatchObject({
			kind: 'count',
			change: { merged: 1, merged_issue: Number(ISSUE), filed: Number(FILED), cuts: 0 },
		})
	})

	it('treats --filed 0 as a count rather than a read', () => {
		expect(request_for(['--filed', '0'])).toMatchObject({ kind: 'count', change: { filed: 0 } })
	})

	it('records a done issue', () => {
		expect(request_for(['--done', ISSUE])).toMatchObject({
			kind: 'count',
			change: { done: Number(ISSUE) },
		})
	})

	it('refuses a count that is not a number', () => {
		expect(request_for(['--merged', 'two'])).toBeUndefined()
		expect(request_for(['--filed', '-1'])).toBeUndefined()
	})

	it('refuses a done value that is not an issue number', () => {
		expect(request_for(['--done', '0'])).toBeUndefined()
		expect(request_for(['--done', '012'])).toBeUndefined()
		expect(request_for(['--done', UNSAFE_ISSUE])).toBeUndefined()
	})
})

describe('run_carry_args.to_request count owner', () => {
	it('carries the owner on a count', () => {
		expect(request_for(['--cut', '--owner', OWN_PID])).toMatchObject({
			kind: 'count',
			owner: run_carry.owner_of(process.pid),
		})
	})
})

describe('run_carry_args.to_request retrospective and summary', () => {
	it('carries the summary with the retrospective mark', () => {
		expect(request_for([RETROSPECTIVE_FLAG, SUMMARY_FLAG, SUMMARY])).toStrictEqual({
			kind: 'count',
			change: { merged: 0, filed: 0, cuts: 0, retrospective: true },
			owner: run_carry.NO_OWNER,
			summary: SUMMARY,
		})
	})

	it('refuses the mark without a summary', () => {
		expect(request_for([RETROSPECTIVE_FLAG])).toBeUndefined()
		expect(request_for([RETROSPECTIVE_FLAG, SUMMARY_FLAG, ''])).toBeUndefined()
	})

	it('refuses a summary without the mark', () => {
		expect(request_for([SUMMARY_FLAG, SUMMARY])).toBeUndefined()
		expect(request_for(['--cut', SUMMARY_FLAG, SUMMARY])).toBeUndefined()
	})
})

describe('run_carry_args.to_request usage errors', () => {
	it('refuses two request groups in one invocation', () => {
		expect(request_for(['--begin', INVOCATION, '--end'])).toBeUndefined()
		expect(request_for(['--begin', INVOCATION, '--resume', INVOCATION])).toBeUndefined()
		expect(request_for(['--cut', '--end'])).toBeUndefined()
		expect(request_for(['--resume', INVOCATION, '--merged', MERGED])).toBeUndefined()
	})

	it('refuses an owner that is not a positive pid', () => {
		expect(request_for(['--begin', INVOCATION, '--owner', '0'])).toBeUndefined()
		expect(request_for(['--begin', INVOCATION, '--owner', 'abc'])).toBeUndefined()
		expect(request_for(['--cut', '--owner=-5'])).toBeUndefined()
	})

	it('accepts and ignores an owner on --end', () => {
		expect(request_for(['--end', '--owner', OWN_PID])).toStrictEqual({
			kind: 'end',
			stopped: undefined,
		})
	})
})

describe('run_carry_args.to_request --merged', () => {
	// joshuafolkken/kit#3296: a bare count cannot be matched against `merged_issues`, so it is refused.
	it('refuses a merged value that is not an issue number', () => {
		expect(request_for(['--merged', '0'])).toBeUndefined()
		expect(request_for(['--merged', '012'])).toBeUndefined()
		expect(request_for(['--merged', UNSAFE_ISSUE])).toBeUndefined()
	})
})
