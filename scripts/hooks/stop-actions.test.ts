import { repo_discovery } from '#scripts/discovery/repo-discovery'
import { git_gh_repo } from '#scripts/gh/git-gh-repo'
import { issue_cite_cli } from '#scripts/issue/issue-cite-cli'
import { telegram_test } from '#scripts/notify/telegram-test'
import type { CliValues } from '#scripts/notify/telegram-test-logic'
import { stop_rules, type StopAction, type StopOutcome } from '#scripts/rules/stop-rules'
import { run_hold_cli } from '#scripts/run/hold/run-hold-cli'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { stop_actions } from './stop-actions'

const REPLY = 'paused for a decision'
const NOTIFY: StopAction = { kind: 'notify', issue: '7', message: REPLY }
const RELEASE: StopAction = { kind: 'release', issue: '7' }
const CITE: StopAction = { kind: 'cite', references: ['#7'] }
const CITATION_LINE = '[#7](https://github.com/joshuafolkken/kit/issues/7) — title'
const NOTICE_KEY = 'systemMessage'
const NOTIFY_NOTICE = 'confirmation notify'
const KIT_ORIGIN = 'git@github.com:joshuafolkken/kit.git'

function record_of(written = '{}'): Record<string, unknown> {
	const parsed: unknown = JSON.parse(written)

	return typeof parsed === 'object' && parsed !== null ? { ...parsed } : {}
}

async function envelope(
	actions: ReadonlyArray<StopAction>,
	blocks_on_failure = true,
): Promise<Record<string, unknown>> {
	const outcome: StopOutcome = { reason: undefined, actions, blocks_on_failure }

	return record_of(await stop_actions.envelope_of(outcome, 'en'))
}

async function field_of(actions: ReadonlyArray<StopAction>, key: string): Promise<string> {
	const written = await envelope(actions)

	return String(written[key])
}

function sent_values(): CliValues {
	return vi.mocked(telegram_test.send_values).mock.calls[0]?.[0] ?? {}
}

beforeEach(() => {
	vi.spyOn(git_gh_repo, 'repo_get_name_with_owner').mockResolvedValue('joshuafolkken/kit')
	vi.spyOn(telegram_test, 'send_values').mockResolvedValue(undefined)
	vi.spyOn(run_hold_cli, 'run').mockResolvedValue(0)
	vi.spyOn(issue_cite_cli, 'cite').mockResolvedValue({ lines: [CITATION_LINE], failures: [] })
})

afterEach(() => {
	vi.restoreAllMocks()
})

// joshuafolkken/kit#3919: the hook runs the fixed operations itself and lets the stop through.
describe('stop_actions.envelope_of — the actions take', () => {
	it('lets the stop through with a notice for each action', async () => {
		const written = await envelope([NOTIFY, RELEASE, CITE])
		const notice = String(written[NOTICE_KEY])

		expect(written).not.toHaveProperty('decision')
		expect(notice).toContain(NOTIFY_NOTICE)
		expect(notice).toContain('released')
		expect(notice).toContain(CITATION_LINE)
	})

	it('sends the confirmation with the held Issue URL and the reply opening', async () => {
		await envelope([NOTIFY])

		expect(sent_values()).toMatchObject({
			'task-type': 'confirmation',
			'issue-url': 'https://github.com/joshuafolkken/kit/issues/7',
			body: REPLY,
		})
	})

	it('links a bare #N the reply carries into the Telegram body', async () => {
		vi.spyOn(repo_discovery, 'read_origin_url').mockReturnValue(KIT_ORIGIN)

		await envelope([{ ...NOTIFY, message: 'paused on #8' }])

		expect(sent_values().body).toBe('paused on [#8](https://github.com/joshuafolkken/kit/issues/8)')
	})

	it('sends a new entry with no Issue URL and releases it bare', async () => {
		await envelope([
			{ kind: 'notify', issue: 'new', message: '' },
			{ kind: 'release', issue: 'new' },
		])

		expect(sent_values()).not.toHaveProperty('issue-url')
		expect(run_hold_cli.run).toHaveBeenCalledWith(['--release'])
	})

	it('releases a numbered hold by its Issue', async () => {
		await envelope([RELEASE])

		expect(run_hold_cli.run).toHaveBeenCalledWith(['--release', '7'])
	})
})

describe('stop_actions.envelope_of — stops with nothing to run', () => {
	it('writes nothing for a stop with no action', async () => {
		expect(await stop_actions.envelope_of(stop_rules.NO_OUTCOME, 'en')).toBeUndefined()
	})

	it('writes the refusal alone for a refused stop', async () => {
		const refused = { ...stop_rules.NO_OUTCOME, reason: 'r' }
		const written = await stop_actions.envelope_of(refused, 'en')

		expect(record_of(written)).toMatchObject({ decision: 'block' })
		expect(issue_cite_cli.cite).not.toHaveBeenCalled()
	})
})

describe('stop_actions.envelope_of — an action fails', () => {
	it('falls back to the refusal of the first failure, keeping the notices of the rest', async () => {
		vi.mocked(run_hold_cli.run).mockResolvedValue(1)

		const written = await envelope([NOTIFY, RELEASE])

		expect(written['decision']).toBe('block')
		expect(String(written['reason'])).toContain(stop_rules.HOLD_RELEASE_REASON)
		expect(String(written[NOTICE_KEY])).toContain(NOTIFY_NOTICE)
	})

	it('treats a throwing send as a failure', async () => {
		vi.mocked(telegram_test.send_values).mockRejectedValue(new Error('telegram down'))

		expect(await field_of([NOTIFY], 'reason')).toContain(stop_rules.STOP_NOTIFY_REASON)
	})

	it('falls back on a citation with any number left unanswered', async () => {
		vi.mocked(issue_cite_cli.cite).mockResolvedValue({ lines: [CITATION_LINE], failures: ['#8'] })

		expect(await field_of([CITE], 'reason')).toContain('pnpm josh issue:cite')
	})

	it('only reports past the loop-breaker, never refusing', async () => {
		vi.mocked(run_hold_cli.run).mockResolvedValue(1)

		const written = await envelope([NOTIFY, RELEASE], false)

		expect(Object.keys(written)).toEqual([NOTICE_KEY])
		expect(String(written[NOTICE_KEY])).toContain(NOTIFY_NOTICE)
	})
})

describe('stop_actions.envelope_of — stdout stays the envelope', () => {
	it('sends what a reused call prints to stderr', async () => {
		vi.mocked(run_hold_cli.run).mockImplementation(async () => {
			process.stdout.write('released\n')

			return 0
		})
		const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
		const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)

		await envelope([RELEASE])

		expect(stdout).not.toHaveBeenCalled()
		expect(stderr).toHaveBeenCalledWith('released\n')
	})
})

describe('stop_actions.summary_of', () => {
	it('stands in a fixed line for an empty reply and cuts a long one', () => {
		expect(stop_actions.summary_of('  ')).not.toBe('')
		expect(stop_actions.summary_of('x'.repeat(1000)).length).toBeLessThan(1000)
	})
})
