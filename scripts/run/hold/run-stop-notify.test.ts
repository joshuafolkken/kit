import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { git_gh_issue_read } from '#scripts/gh/git-gh-issue-read'
import { git_gh_pr_read } from '#scripts/gh/git-gh-pr-read'
import { git_gh_repo } from '#scripts/gh/git-gh-repo'
import { git_command } from '#scripts/git/git-command'
import { telegram_test } from '#scripts/notify/telegram-test'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_hold } from './run-hold'
import { run_hold_session } from './run-hold-session'
import { run_stop_notify } from './run-stop-notify'

const ISSUE = '4135'
const TITLE = 'Send the stop confirmation'
const QUOTED_TITLE = "'Send the stop confirmation #4135'"
const SLUG = 'joshuafolkken/kit'
const BRANCH = '4135-lane'
const ISSUE_URL = 'https://github.com/joshuafolkken/kit/issues/4135'
const PR_URL = 'https://github.com/joshuafolkken/kit/pull/4200'
const HALFRUN_RECOMMENDED = 'Verify by hand, then prrun #4135'
const FULLRUN = 'fullrun #4135'
const RECOMMENDATION_TITLE = 'keeps the recommendation and the alternative the skill text named'
const FACTS = { issue: ISSUE, title: TITLE, issue_url: ISSUE_URL }
const scratch = mkdtempSync(path.join(tmpdir(), 'run-stop-notify-test-'))
const TARGET = run_hold.hold_path(scratch)

function sent_values(): unknown {
	return vi.mocked(telegram_test.send_values).mock.calls[0]?.[0]
}

function notified_at(): string | undefined {
	const read = run_hold.read_hold(TARGET)

	return read.kind === 'held' ? read.hold.notified_at : undefined
}

beforeEach(() => {
	vi.spyOn(git_gh_repo, 'repo_get_name_with_owner').mockResolvedValue(SLUG)
	vi.spyOn(git_gh_issue_read, 'issue_get_title').mockResolvedValue(TITLE)
	vi.spyOn(git_gh_pr_read, 'pr_get_url').mockResolvedValue(PR_URL)
	vi.spyOn(git_command, 'branch').mockResolvedValue(BRANCH)
	vi.spyOn(telegram_test, 'send_values').mockResolvedValue(undefined)
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
	vi.restoreAllMocks()
	rmSync(TARGET, { force: true })
})

afterAll(() => {
	rmSync(scratch, { force: true, recursive: true })
})

describe('halfrun_values', () => {
	it('puts the Next line first, then the commands that ship without an agent', () => {
		const values = run_stop_notify.halfrun_values(FACTS)

		expect(values.body).toBe(
			[
				'halfrun ready for manual verification',
				'Next: prrun #4135 | fullrun #4135',
				`Without an agent: pnpm josh git -y ${QUOTED_TITLE} && pnpm josh followup ${QUOTED_TITLE}`,
			].join('\n'),
		)
		expect(values['issue-url']).toBe(ISSUE_URL)
	})

	it(RECOMMENDATION_TITLE, () => {
		const values = run_stop_notify.halfrun_values(FACTS)

		expect(values['task-type']).toBe('confirmation')
		expect(values.recommended).toBe(HALFRUN_RECOMMENDED)
		expect(values.alternative).toEqual([FULLRUN])
	})

	it('keeps a title carrying a quote one shell argument', () => {
		const values = run_stop_notify.halfrun_values({
			issue: ISSUE,
			title: "Don't $(break)",
			issue_url: undefined,
		})

		expect(values.body).toContain(String.raw`pnpm josh followup 'Don'\''t $(break) #4135'`)
		expect(values).not.toHaveProperty('issue-url')
	})
})

describe('prrun_values', () => {
	it('names the pull request and the Next line', () => {
		const values = run_stop_notify.prrun_values({ ...FACTS, pr_url: PR_URL })

		expect(values.body).toBe(
			[
				`prrun ready to merge: ${PR_URL}`,
				'Next: fullrun #4135',
				`After a manual merge, without an agent: pnpm josh followup ${QUOTED_TITLE}`,
			].join('\n'),
		)
		expect(values['pr-url']).toBe(PR_URL)
	})

	it(RECOMMENDATION_TITLE, () => {
		const values = run_stop_notify.prrun_values(FACTS)

		expect(values.recommended).toBe(FULLRUN)
		expect(values.alternative).toEqual(['Merge by hand, then pnpm josh followup'])
	})
})

describe('send', () => {
	it('sends the halfrun confirmation through the notify call with the title already read', async () => {
		await run_stop_notify.send_halfrun(TARGET, ISSUE)

		expect(sent_values()).toMatchObject({
			'issue-title': TITLE,
			'issue-url': ISSUE_URL,
			recommended: HALFRUN_RECOMMENDED,
		})
	})

	it('sends the prrun confirmation with the branch pull request', async () => {
		await run_stop_notify.send_prrun(TARGET, ISSUE)

		expect(git_gh_pr_read.pr_get_url).toHaveBeenCalledWith(BRANCH)
		expect(sent_values()).toMatchObject({ 'pr-url': PR_URL, recommended: FULLRUN })
	})

	it('stamps the send on the stopped hold, so the Stop hook reads the pause as announced', async () => {
		const pause_start = new Date(Date.now() - 1000).toISOString()

		run_hold.create_stop_hold(TARGET, ISSUE, run_hold.HALFRUN_STOP_FIELDS)
		await run_stop_notify.send_halfrun(TARGET, ISSUE)

		const read = run_hold.read_hold(TARGET)

		expect(read.kind === 'held' && run_hold_session.is_notified_since(read.hold, pause_start)).toBe(
			true,
		)
	})

	it('does not throw when a gh read fails before the send', async () => {
		vi.mocked(git_gh_repo.repo_get_name_with_owner).mockRejectedValue(new Error('gh down'))

		await expect(run_stop_notify.send_prrun(TARGET, ISSUE)).resolves.toBeUndefined()
		expect(telegram_test.send_values).not.toHaveBeenCalled()
	})

	it('leaves the hold unstamped and does not throw when the send fails', async () => {
		vi.mocked(telegram_test.send_values).mockRejectedValue(new Error('gateway timeout'))
		run_hold.create_stop_hold(TARGET, ISSUE, run_hold.HALFRUN_STOP_FIELDS)

		await expect(run_stop_notify.send_halfrun(TARGET, ISSUE)).resolves.toBeUndefined()
		expect(notified_at()).toBeUndefined()
	})
})
