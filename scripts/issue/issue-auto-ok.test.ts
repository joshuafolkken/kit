import { git_command } from '#scripts/git/git-command'
import { run_carry, type RunCarry } from '#scripts/run/carry/run-carry'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { issue_auto_ok } from './issue-auto-ok'
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

async function is_applied(is_opted_out: boolean): Promise<boolean> {
	const decision = await issue_auto_ok.resolve(is_opted_out, CURRENT, CURRENT)

	return decision.is_applied
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe('issue_auto_ok.decide', () => {
	it('applies auto-ok while a backlogrun carry record is live', () => {
		const decision = issue_auto_ok.decide({
			is_opted_out: false,
			is_carried: true,
			branch_labels: undefined,
		})

		expect(decision.is_applied).toBe(true)
	})

	it('applies auto-ok when the branch Issue carries it, in any casing', () => {
		const decision = issue_auto_ok.decide({
			is_opted_out: false,
			is_carried: false,
			branch_labels: ['enhancement', 'Auto-OK'],
		})

		expect(decision.is_applied).toBe(true)
	})

	it('does not apply auto-ok when neither signal holds', () => {
		const decision = issue_auto_ok.decide({
			is_opted_out: false,
			is_carried: false,
			branch_labels: ['enhancement'],
		})

		expect(decision.is_applied).toBe(false)
	})

	it('does not apply auto-ok when opted out, even with both signals', () => {
		const decision = issue_auto_ok.decide({
			is_opted_out: true,
			is_carried: true,
			branch_labels: ['auto-ok'],
		})

		expect(decision.is_applied).toBe(false)
		expect(issue_auto_ok.line_of(decision)).toBe('auto-ok: not applied — --no-auto-ok declared')
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

		expect(await is_applied(false)).toBe(true)
		expect(issue_state_cli.read_issue).not.toHaveBeenCalled()
	})

	it('applies auto-ok when the branch Issue carries it, read in the current repository', async () => {
		stub_reads('3213-lane', false, ['auto-ok'])

		expect(await is_applied(false)).toBe(true)
		expect(issue_state_cli.read_issue).toHaveBeenCalledWith('3213', CURRENT)
	})

	it('does not apply auto-ok when the branch Issue lacks it', async () => {
		stub_reads('3213-lane', false, ['enhancement'])

		expect(await is_applied(false)).toBe(false)
	})

	it('does not apply auto-ok on main with no carry record', async () => {
		stub_reads('main', false)

		expect(await is_applied(false)).toBe(false)
		expect(issue_state_cli.read_issue).not.toHaveBeenCalled()
	})

	it('does not apply auto-ok when the branch Issue cannot be read', async () => {
		stub_reads('3213-lane', false)
		vi.mocked(issue_state_cli.read_issue).mockResolvedValue({ kind: 'unreadable' })

		expect(await is_applied(false)).toBe(false)
	})

	it('reads nothing when opted out', async () => {
		stub_reads('3213-lane', true, ['auto-ok'])

		expect(await is_applied(true)).toBe(false)
		expect(run_carry.read_carry).not.toHaveBeenCalled()
		expect(git_command.branch).not.toHaveBeenCalled()
	})
})

describe('issue_auto_ok.resolve — a filing to another repository', () => {
	it('does not apply auto-ok, reading nothing, even during a backlogrun', async () => {
		stub_reads('3213-lane', true, ['auto-ok'])
		const decision = await issue_auto_ok.resolve(false, 'joshuafolkken/app-kit', CURRENT)

		expect(issue_auto_ok.line_of(decision)).toBe(
			'auto-ok: not applied — the Issue is filed to another repository',
		)
		expect(run_carry.read_carry).not.toHaveBeenCalled()
		expect(issue_state_cli.read_issue).not.toHaveBeenCalled()
	})

	it('treats a target differing only in casing as the current repository', async () => {
		stub_reads('main', true)
		const decision = await issue_auto_ok.resolve(false, 'JoshuaFolkken/Kit', CURRENT)

		expect(decision.is_applied).toBe(true)
	})
})
