import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { describe, expect, it, vi } from 'vitest'
import type { WorkflowHandoff } from './run-handoff-args'
import { run_handoff_brief, type BriefRead } from './run-handoff-brief'

// joshuafolkken/kit#9166: each session takes its own brief path, and a brief already handed off is
// refused unless `--again` says the repeat is meant.

const make_directory = temporary_directory('suite')
const TEMPORARY = make_directory('josh-run-handoff-brief-')
const BRIEF_FILE = path.join(TEMPORARY, 'brief.md')
const BRIEF_TEXT = 'Agreed brief'
const GIT_DIRECTORY = '/repo/.git'
const LOG = '/state/josh-run-handoff-log-fullrun.log'
const AT = 0
// Built at run time so the scan below does not find this test's own source.
const FIXED_BRIEF = [['.josh', 'tmp'].join('/'), 'brief.md'].join('/')
const NO_LEDGER: string | undefined = undefined

writeFileSync(BRIEF_FILE, BRIEF_TEXT)

function handoff(again: boolean): WorkflowHandoff {
	return {
		kind: 'workflow',
		keyword: 'fullrun',
		line: 'fullrun #12',
		brief_file: BRIEF_FILE,
		again,
	}
}

// The ledger after one hand-off of `text`, as `record` writes it.
function ledger_of(text: string): string {
	let ledger = ''

	run_handoff_brief.record(
		{ digest: run_handoff_brief.digest_of(text), git_directory: GIT_DIRECTORY, log: LOG },
		AT,
		(_target, row) => {
			ledger += row
		},
	)

	return ledger
}

function brief_of(request: WorkflowHandoff, ledger: string | undefined): BriefRead {
	return run_handoff_brief.brief_of(request, {
		environment: {},
		git_directory: GIT_DIRECTORY,
		read_ledger: () => ledger,
	})
}

function brief_with(ledger: string | undefined, again = false): BriefRead {
	return brief_of(handoff(again), ledger)
}

describe('run_handoff_brief.brief_path', () => {
	it('gives a different path under .josh/tmp/ on every call', () => {
		const cwd = make_directory('josh-run-handoff-brief-cwd-')
		const first = run_handoff_brief.brief_path(cwd)
		const second = run_handoff_brief.brief_path(cwd)

		expect(first).not.toBe(second)
		expect([first, second].every((brief) => brief.startsWith('.josh/tmp/'))).toBe(true)
	})
})

describe('run_handoff_brief.brief_of', () => {
	it('refuses a brief the ledger holds, naming its time, its log and --again', () => {
		const read = brief_with(ledger_of(BRIEF_TEXT))
		const problem = read.kind === 'problem' ? read.problem : ''

		expect(problem).toContain(`already handed off at ${new Date(AT).toISOString()}`)
		expect([problem.includes(LOG), problem.includes('--again')]).toEqual([true, true])
	})

	it('reads a recorded brief with --again', () => {
		expect(brief_with(ledger_of(BRIEF_TEXT), true)).toMatchObject({
			kind: 'read',
			text: BRIEF_TEXT,
		})
	})

	it('reads a brief whose text differs from every recorded one', () => {
		expect(brief_with(ledger_of('Another brief'))).toMatchObject({ kind: 'read' })
	})

	it('reads a brief when there is no ledger yet', () => {
		expect(brief_with(NO_LEDGER)).toMatchObject({ kind: 'read', text: BRIEF_TEXT })
	})

	it('never checks the generated retrospective brief', () => {
		const retrospective: WorkflowHandoff = {
			...handoff(false),
			keyword: 'retrospective',
			brief_file: undefined,
		}

		expect(brief_of(retrospective, ledger_of(BRIEF_TEXT))).toMatchObject({ digest: undefined })
	})
})

describe('run_handoff_brief.record', () => {
	it('writes no row for the generated brief', () => {
		const append = vi.fn()

		run_handoff_brief.record(
			{ digest: undefined, git_directory: GIT_DIRECTORY, log: LOG },
			AT,
			append,
		)

		expect(append).not.toHaveBeenCalled()
	})

	it('appends to the ledger under the git directory', () => {
		const append = vi.fn()
		const entry = { digest: 'abc', git_directory: GIT_DIRECTORY, log: LOG }

		run_handoff_brief.record(entry, AT, append)

		expect(append).toHaveBeenCalledWith(
			run_handoff_brief.ledger_path(GIT_DIRECTORY),
			expect.any(String),
		)
	})
})

// The fixed path two sessions in one checkout once shared is named by no tracked doc or argument example.
describe('fixed brief path references', () => {
	it('leaves no tracked file naming the shared brief path', () => {
		const found = spawnSync('git', ['grep', '-l', '-F', FIXED_BRIEF], { encoding: 'utf8' })

		expect(found.stdout).toBe('')
	})
})
