import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_event_stream } from './run-event-stream'

// joshuafolkken/kit#2249: `josh run:report`. The stream target and the pending-merge count are both
// mocked, so the CLI is exercised end to end — it renders the appended events through the generator and
// closes with the release tail the mocked verdict implies. This is the "notify receives the generator's
// output" wiring: what this prints is what `josh notify --body-file` sends.

const stream_target_mock = vi.hoisted(() => vi.fn())
const read_pending_mock = vi.hoisted(() => vi.fn())

vi.mock('./run-event-stream-emit', () => ({
	run_event_stream_emit: { stream_target: stream_target_mock },
}))

vi.mock('#scripts/git/git-followup-pending', () => ({
	git_followup_pending: { read_pending: read_pending_mock },
}))

const { run_report_cli } = await import('./run-report-cli')

const TEMPORARY = mkdtempSync(path.join(tmpdir(), 'josh-run-report-cli-'))
const AT = '2026-09-21T00:00:00.000Z'
const SUCCESS = 0
const stdout: Array<string> = []

function seeded_target(): string {
	const target = path.join(TEMPORARY, `${randomUUID()}.jsonl`)

	run_event_stream.append(target, run_event_stream.EVENT_KIND.MERGE, '#7 merged', AT)
	stream_target_mock.mockResolvedValue(target)

	return target
}

beforeEach(() => {
	stream_target_mock.mockReset()
	read_pending_mock.mockReset()
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
