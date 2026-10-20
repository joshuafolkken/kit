import type { CarryRead, run_carry } from '#scripts/run/carry/run-carry'
import { beforeEach, describe, expect, it, vi } from 'vitest'

interface CarryModule {
	run_carry: typeof run_carry
}

// joshuafolkken/kit#4161: `josh run:report --handoff` prints the hand-off report and sends it as the
// `confirmation`, the resume command as its `recommended` choice. The stream, the record, the cost
// figures and the Telegram send are mocked, so what is pinned is the wiring from the reads to the send.

const stream_target_mock = vi.hoisted(() => vi.fn())
const read_carry_mock = vi.hoisted(() => vi.fn())
const repository_directory_mock = vi.hoisted(() => vi.fn())
const confirm_mock = vi.hoisted(() => vi.fn())
const session_figures_mock = vi.hoisted(() => vi.fn())
const read_origin_url_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/run/event/run-event-stream-emit', () => ({
	run_event_stream_emit: { stream_target: stream_target_mock },
}))

// The record's reads are mocked; its arithmetic (`remaining_of`) stays real, since the report reads it.
vi.mock('#scripts/run/carry/run-carry', async (original) => {
	const actual: CarryModule = await original()

	return {
		run_carry: {
			...actual.run_carry,
			carry_path: (directory: string) => directory,
			read_carry: read_carry_mock,
			repository_directory: repository_directory_mock,
		},
	}
})

vi.mock('#scripts/notify/telegram-notify', () => ({
	telegram_notify: { confirm: confirm_mock },
}))

vi.mock('#scripts/cost-runtime/cost-cli', () => ({
	cost_cli: { session_figures: session_figures_mock },
}))

// The origin `session_cite.text` links against, so the linked body is pinned to one repository.
vi.mock('#scripts/discovery/repo-discovery', () => ({
	repo_discovery: { read_origin_url: read_origin_url_mock },
}))

const { run_report_cli } = await import('./run-report-cli')

const SUCCESS = 0
const FAILURE = 1
const HANDOFF = '--handoff'
const RESUME = 'backlogrun #1 #2 --only'
const LINKED_MERGE = '[#1](https://github.com/joshuafolkken/kit/issues/1)'
const stdout: Array<string> = []
const stderr: Array<string> = []

function carried(invocation: string): CarryRead {
	return {
		kind: 'carried',
		carry: {
			invocation,
			started_at: '2026-10-20T00:00:00.000Z',
			merged: 1,
			merged_issues: [1],
			done: [1],
			filed: 0,
			cuts: 0,
			failures: 0,
			outages: 0,
		},
	}
}

beforeEach(() => {
	vi.stubEnv('JOSH_SESSION_LANG', 'ja')
	read_origin_url_mock.mockReturnValue('https://github.com/joshuafolkken/kit.git')
	stream_target_mock.mockResolvedValue(undefined)
	repository_directory_mock.mockResolvedValue('record-directory')
	read_carry_mock.mockReturnValue(carried(RESUME))
	session_figures_mock.mockReturnValue({ verdict: 'over', cost: 200_000, threshold: 135_000 })
	confirm_mock.mockReset().mockResolvedValue(true)
})

beforeEach(() => {
	stdout.length = 0
	stderr.length = 0
	vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
		stdout.push(String(chunk))

		return true
	})
	vi.spyOn(console, 'error').mockImplementation((line: string) => {
		stderr.push(line)
	})
})

describe('josh run:report --handoff', () => {
	it('prints the hand-off report and sends it as the confirmation', async () => {
		expect(await run_report_cli.run([HANDOFF])).toBe(SUCCESS)
		expect(stdout.join('')).toContain(`- **次に打つコマンド**: \`${RESUME}\``)
		expect(confirm_mock).toHaveBeenCalledWith(
			expect.objectContaining({ body: stdout.join('').trimEnd(), recommended: RESUME }),
		)
	})

	it('links the bare issue references and leaves the resume command span alone', async () => {
		await run_report_cli.run([HANDOFF])

		expect(stdout.join('')).toContain(LINKED_MERGE)
		expect(stdout.join('')).toContain(`\`${RESUME}\``)
	})

	it('prints the plain references without a GitHub origin', async () => {
		read_origin_url_mock.mockReturnValue(undefined)
		await run_report_cli.run([HANDOFF])

		expect(stdout.join('')).not.toContain(LINKED_MERGE)
	})

	it('succeeds once printed when the send fails, leaving the failure to the tolerant send', async () => {
		confirm_mock.mockResolvedValue(false)

		expect(await run_report_cli.run([HANDOFF])).toBe(SUCCESS)
		expect(stdout.join('')).toContain(`\`${RESUME}\``)
	})
})

describe('josh run:report --handoff refusals', () => {
	it('sends nothing and says so when the record names no resume command', async () => {
		read_carry_mock.mockReturnValue(carried('not a run'))

		expect(await run_report_cli.run([HANDOFF])).toBe(SUCCESS)
		expect(stderr).toContain(run_report_cli.NO_RESUME_NOTE)
		expect(confirm_mock).not.toHaveBeenCalled()
	})

	it('refuses without a readable run record and sends nothing', async () => {
		read_carry_mock.mockReturnValue({ kind: 'none' })

		expect(await run_report_cli.run([HANDOFF])).toBe(FAILURE)
		expect(stderr).toContain(run_report_cli.NO_RECORD_NOTE)
		expect(confirm_mock).not.toHaveBeenCalled()
	})

	it('refuses an unknown argument with the usage', async () => {
		expect(await run_report_cli.run(['--nonsense'])).toBe(FAILURE)
		expect(stderr).toContain(run_report_cli.USAGE)
		expect(confirm_mock).not.toHaveBeenCalled()
	})
})
