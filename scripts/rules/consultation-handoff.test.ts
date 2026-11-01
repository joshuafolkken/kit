import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { time_hook_transcript } from '#scripts/time-runtime/time-hook-transcript'
import { afterAll, describe, expect, it } from 'vitest'
import { consultation_handoff } from './consultation-handoff'
import { delivered_rules } from './delivered-rules'

// joshuafolkken/kit#5616: a consultation main line hands a workflow keyword to `run:handoff` instead
// of entering the run itself. **Both directions matter**: a silent row lets Fable implement at its
// rate, and one that speaks on filing, or on any other model, refuses a call that was right.

const FABLE = 'claude-fable-5-1'
const OPUS = 'claude-opus-5-5'
const ASTRA = 'gpt-6.1-astra'
const SOL = 'gpt-6.1-sol'
const ENTRY = 'pnpm josh run:entry 12'
const HANDOFF = 'pnpm josh run:handoff fullrun 12 --brief-file brief.md'
const { ROW, is_entry_call, is_handoff_call } = consultation_handoff
const WORK_DIRECTORY = mkdtempSync(path.join(tmpdir(), 'consultation-handoff-'))

afterAll(() => {
	rmSync(WORK_DIRECTORY, { recursive: true, force: true })
})

// Claude Code's placeholder model stands for a transcript that names none.
function transcript_on(model = '<synthetic>'): string {
	const transcript = path.join(WORK_DIRECTORY, `${randomUUID()}.jsonl`)
	const entry = { type: 'assistant', message: { model, content: [] } }

	writeFileSync(transcript, `\n${JSON.stringify(entry)}\n`)

	return transcript
}

function delivered(model: string | undefined, command: string): string | undefined {
	const payload = {
		transcript_path: transcript_on(model),
		tool_name: 'Bash',
		tool_input: { command },
	}

	return delivered_rules.delivery(JSON.stringify(payload))
}

function codex_delivered(payload_model: string, command: string): string | undefined {
	const payload = {
		transcript_path: transcript_on(),
		tool_name: 'Bash',
		tool_input: { command },
		model: payload_model,
	}

	return delivered_rules.delivery(JSON.stringify(payload))
}

function unit_delivered(command: string): string | undefined {
	const agent_id = randomUUID()
	const transcript_path = transcript_on(FABLE)
	const fork = time_hook_transcript.fork_path(transcript_path, agent_id)
	const entry = { type: 'assistant', message: { model: FABLE, content: [] } }

	mkdirSync(path.dirname(fork), { recursive: true })
	writeFileSync(fork, `\n${JSON.stringify(entry)}\n`)

	return delivered_rules.delivery(
		JSON.stringify({ transcript_path, agent_id, tool_name: 'Bash', tool_input: { command } }),
	)
}

describe('consultation-handoff — a Fable main line', () => {
	it.each([
		ENTRY,
		'pnpm josh run:hold',
		'pnpm josh run:hold --adopt 12',
		'cd x && josh run:entry 3',
	])('refuses %s and points at run:handoff', (command) => {
		const reason = delivered(FABLE, command)

		expect(reason).toBe(ROW.reason)
		expect(reason).toContain('pnpm josh run:handoff')
	})

	it.each([
		'pnpm josh issue:file "Title" --body-file body.md',
		'pnpm josh issue:plan 12 --body-file plan.md',
		'pnpm josh epic --add 5353 5622',
		HANDOFF,
	])('lets %s through', (command) => {
		expect(delivered(FABLE, command)).not.toBe(ROW.reason)
	})
})

describe('consultation-handoff — other sessions', () => {
	it('lets run:entry through on Opus', () => {
		expect(delivered(OPUS, ENTRY)).not.toBe(ROW.reason)
	})

	it('stays silent when no entry names a model', () => {
		expect(delivered(undefined, ENTRY)).not.toBe(ROW.reason)
	})

	it('lets a delegated unit through', () => {
		expect(unit_delivered(ENTRY)).not.toBe(ROW.reason)
	})
})

describe('consultation-handoff — a Codex payload', () => {
	it('refuses run:entry on Astra', () => {
		expect(codex_delivered(ASTRA, ENTRY)).toBe(ROW.reason)
	})

	it('lets run:entry through on Sol 6.1', () => {
		expect(codex_delivered(SOL, ENTRY)).not.toBe(ROW.reason)
	})
})

describe('consultation-handoff — is_entry_call', () => {
	it.each([
		[ENTRY, true],
		['josh run:hold 12', true],
		['pnpm josh run:release 12', false],
		['pnpm josh run:prep 12', false],
		['echo run:entry', false],
	])('%s → %s', (command, expected) => {
		expect(is_entry_call(command)).toBe(expected)
	})
})

describe('consultation-handoff — is_handoff_call', () => {
	it.each([
		[HANDOFF, true],
		['josh run:handoff backlogrun', true],
		[ENTRY, false],
	])('%s → %s', (command, expected) => {
		expect(is_handoff_call(command)).toBe(expected)
	})
})
