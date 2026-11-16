import { git_gh_command } from '#scripts/gh/git-gh-command'
import { issue_measured_close } from '#scripts/issue/issue-measured-close'
import { trusted_measure, type CommandRun } from '#scripts/issue/trusted-measure'
import { session_language } from '#scripts/josh/session-language'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { backlog_measure_close } from './backlog-measure-close'

// joshuafolkken/kit#4621: the drive runs a due issue's measurement declaration before it opens a lane.
// The body read, the command, the GitHub writes and the event stream are mocked. The mocks are hoisted,
// so a module graph reloaded under another session language (`reloaded_under`) shares them.

const mocked = vi.hoisted(() => ({
	trusted_measure: { read_trusted_body: vi.fn(), run_command: vi.fn(), text_of: vi.fn() },
	issue_measured_close: { close: vi.fn() },
	git_gh_command: { issue_comment: vi.fn(), issue_get_body: vi.fn() },
	run_event_stream_emit: { emit: vi.fn() },
}))

// The static import reads the declaration keys at load; load it under ja so an exported en does not
// turn the Japanese `DECLARED` unreadable. `session_language.ENV_KEY` is not yet imported here.
vi.hoisted(() => {
	vi.stubEnv('JOSH_SESSION_LANG', 'ja')
})

vi.mock('#scripts/issue/trusted-measure', () => ({ trusted_measure: mocked.trusted_measure }))
vi.mock('#scripts/issue/issue-measured-close', () => ({
	issue_measured_close: mocked.issue_measured_close,
}))
vi.mock('#scripts/gh/git-gh-command', () => ({ git_gh_command: mocked.git_gh_command }))
vi.mock('#scripts/run/event/run-event-stream-emit', () => ({
	run_event_stream_emit: mocked.run_event_stream_emit,
}))

const ISSUE = '4599'
const COMMAND = 'pnpm josh count'
const DECLARED = '## 背景\n\n- 計測宣言: `pnpm josh count` <= 5\n'
const ENGLISH_DECLARED = '## Background\n\n- Measure declaration: `pnpm josh count` <= 5\n'
const UNREADABLE = '値: unreadable'
const UNSAMPLED = 'sample condition not met'
const SINCE = 'since 2026-11-01T00:00:00.000Z'

function given(body: string, run: CommandRun): void {
	vi.mocked(git_gh_command.issue_get_body).mockResolvedValue(body)
	vi.mocked(trusted_measure.read_trusted_body).mockResolvedValue({
		kind: 'trusted',
		body,
		issue: ISSUE,
		author: 'author',
		editor: 'editor',
	})
	vi.mocked(trusted_measure.run_command).mockReturnValue(run)
}

beforeEach(() => {
	// The prose assertions below are Japanese; pin the language an exported en would flip.
	vi.stubEnv(session_language.ENV_KEY, 'ja')
	vi.mocked(git_gh_command.issue_get_body).mockReset().mockResolvedValue(DECLARED)
	vi.mocked(trusted_measure.text_of).mockReturnValue('output')
	vi.mocked(issue_measured_close.close).mockReset().mockResolvedValue(true)
	vi.mocked(git_gh_command.issue_comment).mockReset().mockResolvedValue('url')
	vi.mocked(run_event_stream_emit.emit).mockReset().mockResolvedValue()
})

afterEach(() => {
	vi.unstubAllEnvs()
})

// joshuafolkken/kit#7666: the comment's prose follows the session language; the value, the output
// and `sample condition not met` do not. The declaration's keys are read in the language the module
// graph loaded under (`measure-declaration.ts`), so each case reloads it under its language.
async function reloaded_under(lang: string | undefined): Promise<typeof backlog_measure_close> {
	vi.stubEnv(session_language.ENV_KEY, lang)
	vi.resetModules()
	const reloaded = await import('./backlog-measure-close')

	return reloaded.backlog_measure_close
}

describe('backlog_measure_close.outcome — the session language', () => {
	it.each([
		['unset', undefined, DECLARED, '`backlog:drive` が計測宣言を実行しました。\n\n- 宣言: '],
		['ja', 'ja', DECLARED, '- 値: 3\n- 判定: 範囲内のため、レーンを使わずに Issue を閉じます。'],
		[
			'en',
			'en',
			ENGLISH_DECLARED,
			'- Value: 3\n- Verdict: within the bound, so the issue is closed without a lane.',
		],
	])('writes the result comment in the language of %s', async (_case, lang, body, prose) => {
		const close = await reloaded_under(lang)

		given(body, { kind: 'ok', output: '3' })

		await close.outcome(ISSUE)

		expect(issue_measured_close.close).toHaveBeenCalledWith(ISSUE, expect.stringContaining(prose))
	})

	it.each([
		['ja', DECLARED],
		['en', ENGLISH_DECLARED],
	])('keeps the unmet sample condition in English under %s', async (lang, body) => {
		const close = await reloaded_under(lang)

		given(body, { kind: 'failed', message: `josh lane:value merges: no sample ${SINCE}` })

		await expect(close.outcome(ISSUE)).resolves.toBe('wait')

		expect(git_gh_command.issue_comment).toHaveBeenCalledWith(
			ISSUE,
			expect.stringContaining(UNSAMPLED),
		)
	})
})

describe('backlog_measure_close.outcome — a value within the bound', () => {
	it('closes the issue and puts a measured event on the stream', async () => {
		given(DECLARED, { kind: 'ok', output: '3' })

		await expect(backlog_measure_close.outcome(ISSUE)).resolves.toBe('closed')
		expect(issue_measured_close.close).toHaveBeenCalledWith(ISSUE, expect.stringContaining('値: 3'))
		expect(run_event_stream_emit.emit).toHaveBeenCalledWith(
			run_event_stream.EVENT_KIND.MEASURED,
			`#${ISSUE} measured by backlog:drive: 3 <= 5`,
		)
	})

	it('launches the lane and emits nothing when the close fails', async () => {
		given(DECLARED, { kind: 'ok', output: '3' })
		vi.mocked(issue_measured_close.close).mockResolvedValue(false)

		await expect(backlog_measure_close.outcome(ISSUE)).resolves.toBe('launch')
		expect(run_event_stream_emit.emit).not.toHaveBeenCalled()
	})
})

describe('backlog_measure_close.outcome — handed to the lane with the result', () => {
	it.each([
		['a value out of bound', { kind: 'ok', output: '9' }, '値: 9'],
		['output that is not one number', { kind: 'ok', output: 'nine' }, UNREADABLE],
		['a failed command', { kind: 'failed', message: 'exit 1' }, UNREADABLE],
	] as const)('comments %s and launches', async (_case, run, value) => {
		given(DECLARED, run)

		await expect(backlog_measure_close.outcome(ISSUE)).resolves.toBe('launch')
		expect(git_gh_command.issue_comment).toHaveBeenCalledWith(ISSUE, expect.stringContaining(value))
		expect(issue_measured_close.close).not.toHaveBeenCalled()
	})

	it('still launches when the comment cannot be posted', async () => {
		given(DECLARED, { kind: 'ok', output: '9' })
		vi.mocked(git_gh_command.issue_comment).mockRejectedValue(new Error('HTTP 502'))
		vi.spyOn(console, 'error').mockImplementation(() => undefined)

		await expect(backlog_measure_close.outcome(ISSUE)).resolves.toBe('launch')
	})
})

// joshuafolkken/kit#6503: a `lane:value` with no sample in its period is a wait, not a lane.
describe('backlog_measure_close.outcome — no sample yet', () => {
	it.each([
		['a cell', `josh lane:value cell: no numeric cell ${SINCE}`],
		['a metric', `josh lane:value merges: no sample ${SINCE}`],
	])('comments the unmet sample condition of %s and waits on the stream', async (_case, stderr) => {
		given(DECLARED, { kind: 'failed', message: `Command failed: pnpm josh lane:value\n${stderr}` })

		await expect(backlog_measure_close.outcome(ISSUE)).resolves.toBe('wait')
		expect(git_gh_command.issue_comment).toHaveBeenCalledWith(
			ISSUE,
			expect.stringContaining(UNSAMPLED),
		)
		expect(issue_measured_close.close).not.toHaveBeenCalled()
		expect(run_event_stream_emit.emit).toHaveBeenCalledExactlyOnceWith(
			run_event_stream.EVENT_KIND.SAMPLE_WAIT,
			`#${ISSUE} waiting: ${UNSAMPLED}`,
		)
	})
})

describe('backlog_measure_close.outcome — nothing to run', () => {
	it('launches without a comment when the body declares nothing', async () => {
		given('## 背景\n\n- 種別: 非不具合\n', { kind: 'ok', output: '3' })

		await expect(backlog_measure_close.outcome(ISSUE)).resolves.toBe('launch')
		expect(trusted_measure.read_trusted_body).not.toHaveBeenCalled()
		expect(trusted_measure.run_command).not.toHaveBeenCalled()
		expect(git_gh_command.issue_comment).not.toHaveBeenCalled()
	})

	it('launches without running anything when the body is not trusted', async () => {
		vi.mocked(trusted_measure.read_trusted_body).mockResolvedValue({ kind: 'refused', reason: 'x' })
		vi.mocked(trusted_measure.run_command).mockClear()

		await expect(backlog_measure_close.outcome(ISSUE)).resolves.toBe('launch')
		expect(trusted_measure.run_command).not.toHaveBeenCalled()
		expect(git_gh_command.issue_comment).not.toHaveBeenCalled()
	})
})

describe('backlog_measure_close.outcome — unverified hints never authorize execution', () => {
	it('uses the verified snapshot when the hint declares a different command', async () => {
		given(DECLARED, { kind: 'ok', output: '3' })
		vi.mocked(git_gh_command.issue_get_body).mockResolvedValue(
			DECLARED.replace(COMMAND, 'untrusted-command'),
		)

		await expect(backlog_measure_close.outcome(ISSUE)).resolves.toBe('closed')
		expect(trusted_measure.run_command).toHaveBeenCalledWith(
			COMMAND,
			expect.objectContaining({ body: DECLARED }),
		)
	})

	it('falls back to the verified snapshot when the body hint is unavailable', async () => {
		given(DECLARED, { kind: 'ok', output: '3' })
		vi.mocked(git_gh_command.issue_get_body).mockResolvedValue(undefined)

		await expect(backlog_measure_close.outcome(ISSUE)).resolves.toBe('closed')
		expect(trusted_measure.read_trusted_body).toHaveBeenCalledWith(ISSUE)
	})

	it('does not execute a stale declaration removed from the verified snapshot', async () => {
		given('', { kind: 'ok', output: '3' })
		vi.mocked(git_gh_command.issue_get_body).mockResolvedValue(DECLARED)

		await expect(backlog_measure_close.outcome(ISSUE)).resolves.toBe('launch')
		expect(trusted_measure.run_command).not.toHaveBeenCalled()
	})
})
