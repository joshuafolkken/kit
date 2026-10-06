import { build_text } from '#scripts/notify/telegram-notify'
import { describe, expect, it } from 'vitest'
import { run_wake_cli } from './run-wake-cli'
import type { WakeContext } from './run-wake-describe'

// joshuafolkken/kit#3242. The Telegram limit cuts a long body from the tail, so the line that says
// where the log is must come before the failure note, or the cut takes it.

const LOG_TARGET = '/stub/wake.log'
const LONG_NOTE_REPEAT = 2000

const CONTEXT: WakeContext = {
	carry_target: '/stub/carry.json',
	wake_target: '/stub/wake.json',
	log_target: LOG_TARGET,
	event_target: '/stub/events.jsonl',
	worktree: '/stub/repo',
}

describe('run_wake_cli.warning_body', () => {
	it('keeps the log hint when the Telegram limit cuts a long failure note', () => {
		const note = `error spawn git ENOENT\n${'stderr line\n'.repeat(LONG_NOTE_REPEAT)}`
		const body = run_wake_cli.warning_body({ reason: 'failed', note }, 'The wake failed.', CONTEXT)
		const text = build_text({
			task_type: 'warning',
			repo_name: 'kit',
			issue_title: 'run:wake supervisor',
			body,
			issue_url: undefined,
			pr_url: undefined,
		})

		expect(text).toContain(LOG_TARGET)
		expect(text).toContain('error spawn git ENOENT')
	})

	it('leaves out a missing note', () => {
		const body = run_wake_cli.warning_body(
			{ reason: 'expired', note: undefined },
			'Expired.',
			CONTEXT,
		)

		expect(body.split('\n')).toHaveLength(2)
	})
})
