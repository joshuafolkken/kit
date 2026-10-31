import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { time_transcript_fixture } from '#tools/time/time-transcript-fixture'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_poll_hook } from './run-poll-hook'

const { josh_call_line, prompt_line, result_line, error_result_line } = time_transcript_fixture

const BRANCH = '3925-lane'
const BOARD = 'pnpm josh run:board --chat'
const AWAIT = 'pnpm josh lane:await 1'
const CARRY_JSON = 'pnpm josh run:carry --json'
const TEMPORARY = mkdtempSync(path.join(tmpdir(), 'run-poll-hook-'))
const sequence = { value: 0 }

function write_transcript(lines: ReadonlyArray<string>): string {
	sequence.value += 1
	const transcript_path = path.join(TEMPORARY, `t-${String(sequence.value)}.jsonl`)

	writeFileSync(transcript_path, lines.join('\n'))

	return transcript_path
}

interface CallShape {
	command: string
	tool_name?: string
	agent_id?: string
}

function payload(lines: ReadonlyArray<string>, call: CallShape): string {
	return JSON.stringify({
		transcript_path: write_transcript(lines),
		tool_name: call.tool_name ?? 'Bash',
		tool_input: { command: call.command },
		agent_id: call.agent_id,
	})
}

// A prompt, then one completed `command` call — the step the call in hand follows.
function after(command: string): Array<string> {
	return [prompt_line(0, BRANCH), josh_call_line(1, BRANCH, command), result_line(2, BRANCH)]
}

async function parent(): Promise<boolean> {
	return true
}

async function not_parent(): Promise<boolean> {
	return false
}

afterEach(() => {
	vi.unstubAllEnvs()
})

describe('run_poll_hook.poll_reason — a repeated state read', () => {
	it('refuses the first repeat of the same state read in the parent', async () => {
		const reason = await run_poll_hook.poll_reason(
			payload(after(BOARD), { command: BOARD }),
			parent,
		)

		expect(reason).toBe(run_poll_hook.POLL_REASON)
	})

	it('refuses a repeat that differs only in a reading flag', async () => {
		const raw = payload(after(CARRY_JSON), { command: 'pnpm josh run:carry' })

		expect(await run_poll_hook.poll_reason(raw, parent)).toBe(run_poll_hook.POLL_REASON)
	})

	it('refuses the reissue right after a refusal, which is still a poll', async () => {
		const lines = [
			prompt_line(0, BRANCH),
			josh_call_line(1, BRANCH, BOARD),
			error_result_line(2, BRANCH),
		]

		expect(await run_poll_hook.poll_reason(payload(lines, { command: BOARD }), parent)).toBe(
			run_poll_hook.POLL_REASON,
		)
	})

	it('names the blocking waits in its reason', () => {
		expect(run_poll_hook.POLL_REASON).toContain('backlog:drive')
		expect(run_poll_hook.POLL_REASON).toContain('lane:await')
	})

	// joshuafolkken/kit#5504: the consultation guard refuses `$PPID`, so the wait it names omits `--owner`.
	it('names a wait the consultation guard lets through', () => {
		expect(run_poll_hook.POLL_REASON).not.toContain('$PPID')
	})
})

describe('run_poll_hook.poll_reason — calls it leaves alone', () => {
	it('allows a state read after a different command', async () => {
		const raw = payload(after('pnpm josh lane:list'), { command: BOARD })

		expect(await run_poll_hook.poll_reason(raw, parent)).toBeUndefined()
	})

	it("allows a state read after a person's prompt", async () => {
		const lines = [...after(BOARD), prompt_line(3, BRANCH)]

		expect(
			await run_poll_hook.poll_reason(payload(lines, { command: BOARD }), parent),
		).toBeUndefined()
	})

	it('allows a repeated call that is not a state read', async () => {
		const raw = payload(after(AWAIT), { command: AWAIT })

		expect(await run_poll_hook.poll_reason(raw, parent)).toBeUndefined()
	})

	it('allows the repeat outside the driving parent', async () => {
		const raw = payload(after(BOARD), { command: BOARD })

		expect(await run_poll_hook.poll_reason(raw, not_parent)).toBeUndefined()
	})

	it("allows a delegated unit's call", async () => {
		const raw = payload(after(BOARD), { command: BOARD, agent_id: 'unit-1' })

		expect(await run_poll_hook.poll_reason(raw, parent)).toBeUndefined()
	})

	it('allows the repeat while the switch is off', async () => {
		vi.stubEnv(run_poll_hook.SWITCH_ENV_KEY, 'off')

		const raw = payload(after(BOARD), { command: BOARD })

		expect(await run_poll_hook.poll_reason(raw, parent)).toBeUndefined()
	})

	it('reads no carry record for a call that is no repeat', async () => {
		const is_parent = vi.fn(parent)

		await run_poll_hook.poll_reason(payload(after('ls'), { command: BOARD }), is_parent)

		expect(is_parent).not.toHaveBeenCalled()
	})
})

describe('run_poll_hook.safe_poll_reason', () => {
	it('allows the call when the transcript cannot be read', async () => {
		const raw = JSON.stringify({
			transcript_path: path.join(TEMPORARY, 'missing.jsonl'),
			tool_name: 'Bash',
			tool_input: { command: BOARD },
		})

		expect(await run_poll_hook.safe_poll_reason(raw)).toBeUndefined()
	})
})

describe('run_poll_hook.poll_reason — a writing flag', () => {
	it('allows the hand-off write after a read of the same command', async () => {
		const raw = payload(after(CARRY_JSON), {
			command: 'pnpm josh run:carry --cut --owner "$PPID"',
		})

		expect(await run_poll_hook.poll_reason(raw, parent)).toBeUndefined()
	})

	it('allows a second filing, which counts once more', async () => {
		const filed = 'pnpm josh run:carry --filed --owner "$PPID"'
		const raw = payload(after(filed), { command: filed })

		expect(await run_poll_hook.poll_reason(raw, parent)).toBeUndefined()
	})
})

describe('run_poll_hook.poll_reason — the operands a read names', () => {
	it('allows the same state read on a different child, which is no repeat', async () => {
		const raw = payload(after('pnpm josh lane:output 1 /tmp/a.log'), {
			command: 'pnpm josh lane:output 2 /tmp/b.log',
		})

		expect(await run_poll_hook.poll_reason(raw, parent)).toBeUndefined()
	})
})
