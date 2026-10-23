import { repo_discovery } from '#scripts/discovery/repo-discovery'
import { git_gh_repo } from '#scripts/gh/git-gh-repo'
import { telegram_test } from '#scripts/notify/telegram-test'
import type { CliValues } from '#scripts/notify/telegram-test-logic'
import { stop_rules, type StopAction, type StopOutcome } from '#scripts/rules/stop-rules'
import { stop_rules_fixture } from '#scripts/rules/stop-rules-fixture'
import { run_hold } from '#scripts/run/hold/run-hold'
import { run_hold_cli } from '#scripts/run/hold/run-hold-cli'
import { run_hold_session } from '#scripts/run/hold/run-hold-session'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { stop_actions } from './stop-actions'

const REPLY = 'paused for a decision'
const DECISION = { recommended: 'merge it', alternative: undefined }
const NOTIFY: StopAction = { kind: 'notify', issue: '7', message: REPLY, decision: DECISION }
const RELEASE: StopAction = { kind: 'release', issue: '7' }
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
	vi.spyOn(run_hold, 'worktree_directory').mockResolvedValue('git-dir')
	vi.spyOn(run_hold_session, 'mark_notified').mockReturnValue(undefined)
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('stop_actions.envelope_of — the Telegram body', () => {
	beforeEach(() => {
		vi.spyOn(repo_discovery, 'read_origin_url').mockReturnValue(KIT_ORIGIN)
	})

	it('links a bare #N the reply carries', async () => {
		await envelope([{ ...NOTIFY, message: 'paused on #8' }])

		expect(sent_values().body).toBe('paused on [#8](https://github.com/joshuafolkken/kit/issues/8)')
	})

	it('cuts the reply before linking, so a link near the cut keeps its whole URL', async () => {
		await envelope([{ ...NOTIFY, message: `${'あ'.repeat(560)} #3919 ${'い'.repeat(100)}` }])

		expect(sent_values().body).toContain(
			'[#3919](https://github.com/joshuafolkken/kit/issues/3919)',
		)
	})
})

// joshuafolkken/kit#3919: the hook runs the fixed operations itself and lets the stop through.
describe('stop_actions.envelope_of — the actions take', () => {
	it('lets the stop through with a notice for each action', async () => {
		const written = await envelope([NOTIFY, RELEASE])
		const notice = String(written[NOTICE_KEY])

		expect(written).not.toHaveProperty('decision')
		expect(notice).toContain(NOTIFY_NOTICE)
		expect(notice).toContain('released')
	})

	it('sends the confirmation with the held Issue URL and the reply opening', async () => {
		await envelope([NOTIFY])

		expect(sent_values()).toMatchObject({
			'task-type': 'confirmation',
			'issue-url': 'https://github.com/joshuafolkken/kit/issues/7',
			body: REPLY,
		})
	})

	it('sends a new entry with no Issue URL and releases it bare', async () => {
		await envelope([
			{ ...NOTIFY, issue: 'new', message: '' },
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

// joshuafolkken/kit#3961: the reply's own choices, never a fixed placeholder.
describe('stop_actions.envelope_of — the reply’s decision (#3961)', () => {
	it('carries the reply’s recommended choice, and its alternative only when it names one', async () => {
		await envelope([NOTIFY])

		expect(sent_values()).toMatchObject({ recommended: 'merge it' })
		expect(sent_values()).not.toHaveProperty('alternative')
	})

	it('carries the alternative the reply names', async () => {
		const decision = { recommended: 'merge it', alternative: 'hold it' }

		await envelope([{ ...NOTIFY, decision }])

		expect(sent_values()).toMatchObject({ recommended: 'merge it', alternative: ['hold it'] })
	})

	it('stamps the send on the hold so the same pause is not announced again', async () => {
		await envelope([NOTIFY])

		expect(run_hold_session.mark_notified).toHaveBeenCalledOnce()
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
		expect(telegram_test.send_values).not.toHaveBeenCalled()
	})
})

// joshuafolkken/kit#4626: the reply's bare `#N` gets no citation lines and no refusal from the hook.
describe('stop_actions.envelope_of — a reply carrying a bare #N', () => {
	const { context, DECISION_MESSAGE } = stop_rules_fixture

	it('writes nothing for a stop with no hold', async () => {
		const outcome = stop_rules.stop_outcome(context({ message: 'done in #7 and #8' }))

		expect(await stop_actions.envelope_of(outcome, 'en')).toBeUndefined()
	})

	it('shows the hold actions alone, with no citation line', async () => {
		const held = context({ hold_issue: '7', tree_clean: true, message: `${DECISION_MESSAGE} #8` })
		const written = record_of(await stop_actions.envelope_of(stop_rules.stop_outcome(held), 'en'))
		const notice = String(written[NOTICE_KEY])

		expect(written).not.toHaveProperty('decision')
		expect(notice).toContain('released')
		expect(notice).not.toContain('Issue citations')
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

	it('keeps a sent notify done when its stamp on the hold fails', async () => {
		vi.mocked(run_hold_session.mark_notified).mockImplementation(() => {
			throw new Error('stamp race')
		})
		vi.spyOn(console, 'warn').mockReturnValue(undefined)

		const written = await envelope([NOTIFY])

		expect(written).not.toHaveProperty('decision')
		expect(String(written[NOTICE_KEY])).toContain(NOTIFY_NOTICE)
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
	it('stands in a fixed line for an empty reply and cuts a long one at 600 characters', () => {
		expect(stop_actions.summary_of('  ')).not.toBe('')
		expect(stop_actions.summary_of('x'.repeat(1000))).toHaveLength(600)
		expect(stop_actions.summary_of('あ'.repeat(1000))).toHaveLength(600)
	})

	it('drops a reference the cut would halve instead of keeping its prefix', () => {
		const opening = 'あ'.repeat(597)

		expect(stop_actions.summary_of(`${opening} #3919 rest`)).toBe(`${opening} `)
	})

	it('keeps a reference that ends exactly at the cut', () => {
		const opening = 'あ'.repeat(595)

		expect(stop_actions.summary_of(`${opening}#3919 rest`)).toBe(`${opening}#3919`)
	})
})
