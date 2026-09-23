import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_event_stream } from './run-event-stream'
import { run_report } from './run-report'

// joshuafolkken/kit#2249: `josh run:report`. The stream target and the pending-merge count are both
// mocked, so the CLI is exercised end to end — it renders the appended events through the generator and
// closes with the release tail the mocked verdict implies. This is the "notify receives the generator's
// output" wiring: what this prints is what `josh notify --body-file` sends.

const stream_target_mock = vi.hoisted(() => vi.fn())
const read_pending_mock = vi.hoisted(() => vi.fn())
const repository_directory_mock = vi.hoisted(() => vi.fn())
const read_carry_mock = vi.hoisted(() => vi.fn())

vi.mock('./run-event-stream-emit', () => ({
	run_event_stream_emit: { stream_target: stream_target_mock },
}))

vi.mock('#scripts/git/git-followup-pending', () => ({
	git_followup_pending: { read_pending: read_pending_mock },
}))

// joshuafolkken/kit#2393: the CLI reads the invocation's start time off the run record, so the record is
// mocked alongside the stream — what this pins is the wiring, that the scope reaches the generator at all.
vi.mock('./run-carry', () => ({
	run_carry: {
		carry_path: (directory: string) => directory,
		read_carry: read_carry_mock,
		repository_directory: repository_directory_mock,
	},
}))

const { run_report_cli } = await import('./run-report-cli')

const TEMPORARY = mkdtempSync(path.join(tmpdir(), 'josh-run-report-cli-'))
const AT = '2026-09-21T00:00:00.000Z'
const EARLIER_AT = '2026-09-19T18:00:14.732Z'
const EARLIER_TEXT = '#2216 merged'
const SUCCESS = 0
const stdout: Array<string> = []

function seeded_target(): string {
	const target = path.join(TEMPORARY, `${randomUUID()}.jsonl`)

	run_event_stream.append(target, run_event_stream.EVENT_KIND.MERGE, '#7 merged', AT)
	stream_target_mock.mockResolvedValue(target)

	return target
}

function carried_record(): void {
	repository_directory_mock.mockResolvedValue(TEMPORARY)
	read_carry_mock.mockReturnValue({
		kind: 'carried',
		carry: { invocation: 'fullrun #2393', started_at: AT },
	})
}

beforeEach(() => {
	stream_target_mock.mockReset()
	read_pending_mock.mockReset()
	repository_directory_mock.mockReset()
	read_carry_mock.mockReset()
	carried_record()
	stdout.length = 0
	vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
		stdout.push(String(chunk))

		return true
	})
})

afterAll(() => {
	rmSync(TEMPORARY, { force: true, recursive: true })
})

describe('run_report_cli.run', () => {
	it('renders the stream and closes with the release command when one is owed', async () => {
		seeded_target()
		read_pending_mock.mockResolvedValue(3)

		expect(await run_report_cli.run()).toBe(SUCCESS)
		expect(stdout.join('')).toContain('#7 merged')
		expect(stdout.join('')).toContain('pnpm josh release')
	})

	it('renders an empty run without a tail when no release is owed', async () => {
		stream_target_mock.mockResolvedValue(undefined)
		read_pending_mock.mockResolvedValue(0)

		expect(await run_report_cli.run()).toBe(SUCCESS)
		expect(stdout.join('')).toBe('\n')
	})
})

// The stream as it was observed: this invocation's merge with an earlier invocation's ahead of it.
function seeded_with_earlier(): void {
	const target = seeded_target()

	run_event_stream.append(target, run_event_stream.EVENT_KIND.MERGE, EARLIER_TEXT, EARLIER_AT)
	read_pending_mock.mockResolvedValue(0)
}

// joshuafolkken/kit#2393: the scope reaches the generator through the CLI, so the boundary is pinned end to
// end with only the record and the stream target mocked.
describe('run_report_cli.run — the invocation scope', () => {
	it('leaves an earlier invocation off the body it hands to notify', async () => {
		seeded_with_earlier()

		expect(await run_report_cli.run()).toBe(SUCCESS)
		expect(stdout.join('')).not.toContain(EARLIER_TEXT)
		expect(stdout.join('')).toContain('#7 merged')
	})

	it('prints the notice when the checkout has no git directory to read a record from', async () => {
		seeded_with_earlier()
		repository_directory_mock.mockResolvedValue(undefined)

		expect(await run_report_cli.run()).toBe(SUCCESS)
		expect(stdout.join('')).toContain(run_report.UNKNOWN_SCOPE_NOTICE)
		expect(stdout.join('')).not.toContain(EARLIER_TEXT)
	})

	it('prints the notice rather than the whole stream when no run record is there', async () => {
		seeded_with_earlier()
		read_carry_mock.mockReturnValue({ kind: 'none' })

		expect(await run_report_cli.run()).toBe(SUCCESS)
		expect(stdout.join('')).toContain(run_report.UNKNOWN_SCOPE_NOTICE)
		expect(stdout.join('')).not.toContain(EARLIER_TEXT)
	})
})
