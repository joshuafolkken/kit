import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

// joshuafolkken/kit#2205: `josh run:event`. The target resolver is mocked to a temp file, so the CLI is
// exercised end to end — append returns a position, a kind outside the enumeration is refused, `--from`
// reads a positioned slice, and `--last` reads the degenerate single event.

const stream_target_mock = vi.hoisted(() => vi.fn())

vi.mock('./run-event-stream-emit', () => ({
	run_event_stream_emit: { stream_target: stream_target_mock },
}))

const { run_event_cli } = await import('./run-event-cli')

const TEMPORARY = mkdtempSync(path.join(tmpdir(), 'josh-run-event-cli-'))
const SUCCESS = 0
const FAILURE = 1
const stdout: Array<string> = []
const stderr: Array<string> = []

function fresh_target(): string {
	const target = path.join(TEMPORARY, `${randomUUID()}.jsonl`)

	stream_target_mock.mockResolvedValue(target)

	return target
}

beforeEach(() => {
	stream_target_mock.mockReset()
	stdout.length = 0
	stderr.length = 0
	vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
		stdout.push(String(chunk))

		return true
	})
	vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
		stderr.push(String(chunk))

		return true
	})
})

afterAll(() => {
	rmSync(TEMPORARY, { force: true, recursive: true })
})

interface StreamRead {
	events: Array<{ text: string }>
	next_position: number
}

describe('run_event_cli.run — append', () => {
	it('appends an enumerated event and prints its position', async () => {
		fresh_target()

		expect(await run_event_cli.run(['--append', 'merge', '#7', 'merged'])).toBe(SUCCESS)
		expect(stdout.join('')).toBe('1\n')
	})

	it('refuses a kind outside the enumeration', async () => {
		fresh_target()

		expect(await run_event_cli.run(['--append', 'gossip', 'nope'])).toBe(FAILURE)
		expect(stderr.join('')).toContain('not a session-facing event kind')
	})
})

describe('run_event_cli.run — read', () => {
	it('reads every event after a position', async () => {
		fresh_target()
		await run_event_cli.run(['--append', 'plan', 'planned'])
		await run_event_cli.run(['--append', 'merge', 'merged'])
		stdout.length = 0

		expect(await run_event_cli.run(['--from', '1'])).toBe(SUCCESS)

		const read = JSON.parse(stdout.join('')) as StreamRead

		expect(read.events.map((event) => event.text)).toStrictEqual(['merged'])
		expect(read.next_position).toBe(2)
	})

	it('follows from a position, relaying new events on stdout and the next position on stderr', async () => {
		fresh_target()
		await run_event_cli.run(['--append', 'plan', 'planned'])
		await run_event_cli.run(['--append', 'merge', 'merged'])
		stdout.length = 0
		stderr.length = 0

		expect(await run_event_cli.run(['--follow', '1'])).toBe(SUCCESS)
		expect(stdout.join('')).toContain('merged')
		expect(stdout.join('')).not.toContain('planned')
		expect(stderr.join('')).toContain('next_position: 2')
	})

	it('reads the newest event with --last', async () => {
		fresh_target()
		await run_event_cli.run(['--append', 'plan', 'planned'])
		await run_event_cli.run(['--append', 'stop', 'stopped'])
		stdout.length = 0

		expect(await run_event_cli.run(['--last'])).toBe(SUCCESS)
		expect((JSON.parse(stdout.join('')) as { text: string }).text).toBe('stopped')
	})
})

describe('run_event_cli.run — usage', () => {
	it('reports usage for an unknown flag', async () => {
		expect(await run_event_cli.run(['--nope'])).toBe(FAILURE)
		expect(stderr.join('')).toContain('Usage: josh run:event')
	})
})
