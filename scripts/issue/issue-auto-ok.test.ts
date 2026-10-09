import { git_command } from '#scripts/git/git-command'
import { run_carry, type RunCarry } from '#scripts/run/carry/run-carry'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { issue_auto_ok, type AutoOkDeclared, type AutoOkSignals } from './issue-auto-ok'
import { issue_state_cli } from './issue-state-cli'

// joshuafolkken/kit#3213: `issue:file` applies `auto-ok` by default to an Issue filed during a
// `backlogrun` or from a branch whose Issue carries `auto-ok`, unless `--no-auto-ok` is declared.

const GIT_DIRECTORY = '/repo/.git'
const CURRENT = 'joshuafolkken/kit'
const CARRY: RunCarry = {
	invocation: 'backlogrun',
	started_at: '2026-10-05T00:00:00.000Z',
	merged: 0,
	filed: 0,
	cuts: 0,
	failures: 0,
	outages: 0,
}
const UNDECLARED: AutoOkDeclared = { is_opted_out: false, is_requested: false }
const OPTED_OUT: AutoOkDeclared = { is_opted_out: true, is_requested: false }
const REQUESTED: AutoOkDeclared = { is_opted_out: false, is_requested: true }
const WITHHELD_TITLE = 'does not apply auto-ok (carried: $is_carried)'

function state_of(
	labels: ReadonlyArray<string>,
): Awaited<ReturnType<typeof issue_state_cli.read_issue>> {
	return { kind: 'state', state: { state: 'OPEN', labels, is_human_review: false } }
}

function stub_reads(branch: string, is_carried: boolean, labels: ReadonlyArray<string> = []): void {
	vi.spyOn(run_carry, 'repository_directory').mockResolvedValue(GIT_DIRECTORY)
	vi.spyOn(run_carry, 'read_carry').mockReturnValue(
		is_carried ? { kind: 'carried', carry: CARRY } : { kind: 'none' },
	)
	vi.spyOn(git_command, 'branch').mockResolvedValue(branch)
	vi.spyOn(issue_state_cli, 'read_issue').mockResolvedValue(state_of(labels))
}

function signals_of(overrides: Partial<AutoOkSignals>): AutoOkSignals {
	return {
		...UNDECLARED,
		is_release: false,
		is_carried: false,
		branch_labels: undefined,
		...overrides,
	}
}

async function is_applied(declared: AutoOkDeclared): Promise<boolean> {
	const decision = await issue_auto_ok.resolve(declared, CURRENT, CURRENT)

	return decision.is_applied
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe('issue_auto_ok.decide', () => {
	it('applies auto-ok while a backlogrun carry record is live', () => {
		const decision = issue_auto_ok.decide(signals_of({ is_carried: true }))

		expect(decision.is_applied).toBe(true)
	})

	it('applies auto-ok when the branch Issue carries it, in any casing', () => {
		const decision = issue_auto_ok.decide(signals_of({ branch_labels: ['enhancement', 'Auto-OK'] }))

		expect(decision.is_applied).toBe(true)
	})

	it('does not apply auto-ok when neither signal holds', () => {
		const decision = issue_auto_ok.decide(signals_of({ branch_labels: ['enhancement'] }))

		expect(decision.is_applied).toBe(false)
	})
})

describe('issue_auto_ok.decide — opted out', () => {
	it('does not apply auto-ok when opted out, even with both signals', () => {
		const decision = issue_auto_ok.decide(
			signals_of({ ...OPTED_OUT, is_carried: true, branch_labels: ['auto-ok'] }),
		)

		expect(decision.is_applied).toBe(false)
		expect(issue_auto_ok.line_of(decision)).toBe('auto-ok: not applied — --no-auto-ok declared')
	})
})

// joshuafolkken/kit#3614: a filing a person asked for takes `auto-ok` only from their own `--label`.
describe('issue_auto_ok.decide — a filing a person requested', () => {
	it.each([
		{ is_carried: true, branch_labels: undefined },
		{ is_carried: false, branch_labels: ['auto-ok'] },
	])(WITHHELD_TITLE, (signals) => {
		const decision = issue_auto_ok.decide(signals_of({ ...REQUESTED, ...signals }))

		expect(decision.is_applied).toBe(false)
		expect(issue_auto_ok.line_of(decision)).toBe(
			'auto-ok: not applied — a person asked for this filing; auto-ok only when they declare it',
		)
	})
})

// joshuafolkken/kit#3360: a release is Tier C, so a `release` Issue is opted in by a person only.
describe('issue_auto_ok.decide — a release Issue', () => {
	it.each([
		{ is_carried: true, branch_labels: undefined },
		{ is_carried: false, branch_labels: ['auto-ok'] },
	])(WITHHELD_TITLE, (signals) => {
		const decision = issue_auto_ok.decide(signals_of({ is_release: true, ...signals }))

		expect(decision.is_applied).toBe(false)
		expect(issue_auto_ok.line_of(decision)).toBe(
			'auto-ok: not applied — a release Issue is opted in by a person only',
		)
	})
})

describe('issue_auto_ok.resolve — a release Issue', () => {
	it.each([
		{ branch: 'main', is_carried: true },
		{ branch: '3213-lane', is_carried: false },
	])('does not apply auto-ok, reading nothing, on $branch', async ({ branch, is_carried }) => {
		stub_reads(branch, is_carried, ['auto-ok'])
		const decision = await issue_auto_ok.resolve(UNDECLARED, CURRENT, CURRENT, ['Release'])

		expect(decision.is_applied).toBe(false)
		expect(run_carry.read_carry).not.toHaveBeenCalled()
		expect(issue_state_cli.read_issue).not.toHaveBeenCalled()
	})
})

describe('issue_auto_ok.line_of', () => {
	it('states the decision and its reason on one line', () => {
		const line = issue_auto_ok.line_of({ is_applied: true, reason: 'a reason' })

		expect(line).toBe('auto-ok: applied — a reason')
	})
})

describe('issue_auto_ok.resolve', () => {
	it('applies auto-ok from a live carry record without reading the branch Issue', async () => {
		stub_reads('main', true)

		expect(await is_applied(UNDECLARED)).toBe(true)
		expect(issue_state_cli.read_issue).not.toHaveBeenCalled()
	})

	it('applies auto-ok when the branch Issue carries it, read in the current repository', async () => {
		stub_reads('3213-lane', false, ['auto-ok'])

		expect(await is_applied(UNDECLARED)).toBe(true)
		expect(issue_state_cli.read_issue).toHaveBeenCalledWith('3213', CURRENT)
	})

	it('does not apply auto-ok when the branch Issue lacks it', async () => {
		stub_reads('3213-lane', false, ['enhancement'])

		expect(await is_applied(UNDECLARED)).toBe(false)
	})

	it('does not apply auto-ok on main with no carry record', async () => {
		stub_reads('main', false)

		expect(await is_applied(UNDECLARED)).toBe(false)
		expect(issue_state_cli.read_issue).not.toHaveBeenCalled()
	})

	it('does not apply auto-ok when the branch Issue cannot be read', async () => {
		stub_reads('3213-lane', false)
		vi.mocked(issue_state_cli.read_issue).mockResolvedValue({ kind: 'unreadable' })

		expect(await is_applied(UNDECLARED)).toBe(false)
	})
})

// joshuafolkken/kit#3614: a filing a person asked for reads neither the carry record nor the branch.
describe('issue_auto_ok.resolve — a declared filing', () => {
	it.each([
		['opted out', OPTED_OUT],
		['requested', REQUESTED],
	])(
		'reads nothing when %s, even with a live carry record and an auto-ok branch',
		async (_, declared) => {
			stub_reads('3213-lane', true, ['auto-ok'])

			expect(await is_applied(declared)).toBe(false)
			expect(run_carry.read_carry).not.toHaveBeenCalled()
			expect(git_command.branch).not.toHaveBeenCalled()
		},
	)
})

describe('issue_auto_ok.resolve — a filing to another repository', () => {
	it('does not apply auto-ok, reading nothing, even during a backlogrun', async () => {
		stub_reads('3213-lane', true, ['auto-ok'])
		const decision = await issue_auto_ok.resolve(UNDECLARED, 'joshuafolkken/app-kit', CURRENT)

		expect(issue_auto_ok.line_of(decision)).toBe(
			'auto-ok: not applied — the Issue is filed to another repository',
		)
		expect(run_carry.read_carry).not.toHaveBeenCalled()
		expect(issue_state_cli.read_issue).not.toHaveBeenCalled()
	})

	it('treats a target differing only in casing as the current repository', async () => {
		stub_reads('main', true)
		const decision = await issue_auto_ok.resolve(UNDECLARED, 'JoshuaFolkken/Kit', CURRENT)

		expect(decision.is_applied).toBe(true)
	})
})
