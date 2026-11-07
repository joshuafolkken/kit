import path from 'node:path'
import { change_base } from '#scripts/git/change-base'
import { git_command } from '#scripts/git/git-command'
import { observation_ledger_home } from '#scripts/observations/observation-ledger-home'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { review_finding_ledger } from './review-finding-ledger'
import { review_interaction } from './review-interaction'
import { selfcheck_cli } from './selfcheck-cli'
import { selfcheck_report } from './selfcheck-report'

const USAGE_LINE = 'usage: josh review:selfcheck [--interaction-answered]'
const DUE = ['scripts/run/ship/x.ts']
const ISSUE = 5832
const make_directory = temporary_directory('suite')
const TEST_DIRECTORY = make_directory('selfcheck-record-')

afterEach(() => {
	vi.restoreAllMocks()
	vi.unstubAllEnvs()
})

// A checkout on the issue's branch whose ledger holds only round 1's `/code-review` line.
async function code_round_only(name: string): Promise<string> {
	const root = path.join(TEST_DIRECTORY, name)
	const line = review_finding_ledger.zero_round_line('2026-11-02', ISSUE)

	await observation_ledger_home.append(observation_ledger_home.issue_path(ISSUE, root), [line])
	vi.spyOn(git_command, 'branch').mockResolvedValue(`${String(ISSUE)}-lane`)
	vi.spyOn(console, 'info').mockReturnValue(undefined)

	return root
}

async function slots_of(root: string): Promise<ReadonlyArray<string>> {
	return review_interaction.round_one_slots(await review_interaction.status_of(ISSUE, DUE, root))
}

describe('selfcheck_cli.run', () => {
	it('refuses an argument with the usage line and exit 2, before reading git', async () => {
		const error = vi.spyOn(console, 'error').mockReturnValue(undefined)

		expect(await selfcheck_cli.run(['--all'])).toBe(selfcheck_report.FAILED_EXIT)
		expect(error).toHaveBeenCalledWith(USAGE_LINE)
	})

	it('refuses another argument beside --interaction-answered', async () => {
		const error = vi.spyOn(console, 'error').mockReturnValue(undefined)

		expect(await selfcheck_cli.run(['--interaction-answered', '--all'])).toBe(
			selfcheck_report.FAILED_EXIT,
		)
		expect(error).toHaveBeenCalledWith(USAGE_LINE)
	})
})

// joshuafolkken/kit#5832: a passing, due self-check run with `--interaction-answered` records the
// interaction round, so round 1 opens the code slot alone and no separate interaction reviewer runs.
describe('selfcheck_cli.record_answer', () => {
	it('records the answers on a passing due change, so round 1 owes no interaction reviewer', async () => {
		const root = await code_round_only('answered')

		await selfcheck_cli.record_answer(root, DUE, 0)

		expect(await review_interaction.status_of(ISSUE, DUE, root)).toBe('ok')
		expect(await slots_of(root)).toEqual(['code'])
	})

	it('records nothing on a failed self-check, so the interaction reviewer still runs', async () => {
		const root = await code_round_only('failed')

		await selfcheck_cli.record_answer(root, DUE, 1)

		expect(await review_interaction.status_of(ISSUE, DUE, root)).toBe('missing')
		expect(await slots_of(root)).toEqual(['code', 'interaction'])
	})

	it('records nothing when no interaction review is due', async () => {
		const root = await code_round_only('not-due')

		await selfcheck_cli.record_answer(root, [], 0)

		expect(await review_interaction.status_of(ISSUE, DUE, root)).toBe('missing')
	})

	it('records nothing and says so when the branch names no issue', async () => {
		const root = await code_round_only('no-issue')
		const error = vi.spyOn(console, 'error').mockReturnValue(undefined)

		vi.spyOn(git_command, 'branch').mockResolvedValue('main')
		await selfcheck_cli.record_answer(root, DUE, 0)

		expect(await review_interaction.status_of(ISSUE, DUE, root)).toBe('missing')
		expect(error).toHaveBeenCalledWith(expect.stringContaining('the branch names no issue'))
	})
})

describe('selfcheck_cli.guarded', () => {
	it('answers a git call that throws with exit 2, never as 1 found or 0 pass', async () => {
		const error = vi.spyOn(console, 'error').mockReturnValue(undefined)

		vi.spyOn(change_base, 'resolved').mockRejectedValue(new Error('no repository'))

		expect(await selfcheck_cli.guarded([])).toBe(selfcheck_report.FAILED_EXIT)
		expect(error).toHaveBeenCalledWith('review:selfcheck: Error: no repository')
	})
})

describe('selfcheck_cli.child_environment', () => {
	it('drops the parent pnpm script context, so a probe resolves its own cwd', () => {
		const root = '/lane/root'

		vi.stubEnv('INIT_CWD', root)
		vi.stubEnv('npm_package_json', `${root}/package.json`)
		vi.stubEnv('PNPM_SCRIPT_SRC_DIR', root)
		vi.stubEnv('JOSH_SESSION_LANG', 'ja')

		const environment = selfcheck_cli.child_environment()

		expect(environment['INIT_CWD']).toBeUndefined()
		expect(environment['npm_package_json']).toBeUndefined()
		expect(environment['PNPM_SCRIPT_SRC_DIR']).toBeUndefined()
		expect(environment['JOSH_SESSION_LANG']).toBe('ja')
	})
})
