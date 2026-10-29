import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { agent_model } from './agent-model'
import { consultation_investigation } from './consultation-investigation'
import { delivered_rules } from './delivered-rules'

// joshuafolkken/kit#5351: a main line on the consultation model hands broad investigation to a unit.
// **Both directions matter**: a row silent on a broad call leaves the rate where it was, and one that
// speaks on a narrow check — or on any other model — refuses a call that already did the right thing.

const FABLE = 'claude-fable-5-1'
const OPUS = 'claude-opus-5-5'
const SONNET = 'claude-sonnet-5-5'
const ASTRA = 'gpt-6.1-astra'
const SOL = 'gpt-6.1-sol'
const NARROW_LIMIT = 200
const BROAD_LIMIT = 201
const ONE_FILE = 'package.json'
const TREE_GREP = 'grep -rn guard scripts'
const PROMPT = 'Find where the guard reads the transcript'
const { ROW, CODEX_ROW } = consultation_investigation
const WORK_DIRECTORY = mkdtempSync(path.join(tmpdir(), 'consultation-investigation-'))

afterAll(() => {
	rmSync(WORK_DIRECTORY, { recursive: true, force: true })
})

afterEach(() => {
	vi.unstubAllEnvs()
})

// A transcript of its own per call, its newest assistant entry naming the main line's model.
// Claude Code's placeholder model stands for a transcript that names none.
function transcript_on(model = '<synthetic>'): string {
	const transcript = path.join(WORK_DIRECTORY, `${randomUUID()}.jsonl`)
	const entry = { type: 'assistant', message: { model, content: [] } }

	writeFileSync(transcript, `\n${JSON.stringify(entry)}\n`)

	return transcript
}

function delivered(
	model: string | undefined,
	tool_name: string,
	tool_input: Record<string, unknown>,
): string | undefined {
	const payload = { transcript_path: transcript_on(model), tool_name, tool_input }

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

function dispatch(input: Record<string, unknown>): Record<string, unknown> {
	return { prompt: PROMPT, run_in_background: false, ...input }
}

describe('consultation-investigation — a Fable main line', () => {
	it.each([
		['a `Read` with no limit', 'Read', { file_path: ONE_FILE }],
		['a `Read` past the cap', 'Read', { file_path: ONE_FILE, limit: BROAD_LIMIT }],
		['a recursive grep of a directory', 'Bash', { command: TREE_GREP }],
		['a `Glob`', 'Glob', { pattern: '**/*.ts' }],
		['a `Grep` with no path', 'Grep', { pattern: 'guard' }],
		['a general-purpose unit on Fable', 'Agent', dispatch({ model: 'fable' })],
	])('refuses %s', (_case, tool, input) => {
		expect(delivered(FABLE, tool, input)).toBe(ROW.reason)
	})

	it.each([
		['a `Read` within the cap', 'Read', { file_path: ONE_FILE, limit: NARROW_LIMIT }],
		['a grep of one file', 'Bash', { command: `grep -n guard ${ONE_FILE}` }],
		['a `Grep` of one file', 'Grep', { pattern: 'guard', path: ONE_FILE }],
		[
			'an investigator on opus',
			'Agent',
			dispatch({ subagent_type: 'investigator', model: 'opus' }),
		],
		[
			'an investigator on its definition model',
			'Agent',
			dispatch({ subagent_type: 'investigator' }),
		],
	])('lets %s through', (_case, tool, input) => {
		expect(delivered(FABLE, tool, input)).toBeUndefined()
	})

	it('refuses a general-purpose unit with no model, `agent-model` speaking first', () => {
		const input = dispatch({ subagent_type: 'general-purpose' })

		expect(delivered(FABLE, 'Agent', input)).toBe(agent_model.AGENT_MODEL_REASON)
	})
})

describe('consultation-investigation — the reason', () => {
	it('names the investigation model and a narrow example', () => {
		expect(ROW.reason).toContain(OPUS)
		expect(ROW.reason).toContain(`<= ${String(NARROW_LIMIT)}`)
	})

	it('scores an investigator dispatch as keeping the rule', () => {
		const call = { name: 'Agent', input: { subagent_type: 'investigator' } }

		expect(ROW.keeps?.(call, [call], [call])).toBe(true)
	})

	// The hook loads `.env` after the rows are imported, so the model is read at delivery.
	it('names an investigation model set after import', () => {
		vi.stubEnv('JOSH_INVESTIGATION_MODEL', SONNET)

		expect(ROW.reason).toContain(SONNET)
	})
})

// A unit or a reviewer has no `Agent` tool, so the remedy is not theirs to take.
describe('consultation-investigation — a session that cannot dispatch', () => {
	const glob = { name: 'Glob', input: { pattern: '**/*.ts' } }
	const tail = `\n${JSON.stringify({ type: 'assistant', message: { model: FABLE } })}\n`

	function is_satisfied(is_unit: boolean): boolean | undefined {
		return ROW.already_satisfied?.(tail, glob, { transcript: '', now_ms: 0, is_unit })
	}

	it('refuses the Fable main line', () => {
		expect(is_satisfied(false)).toBe(false)
	})

	it('stands down inside a delegated unit', () => {
		expect(is_satisfied(true)).toBe(true)
	})

	it('stands down in a reviewer session', () => {
		vi.stubEnv('JOSH_AGENT_ROLE', 'reviewer')

		expect(is_satisfied(false)).toBe(true)
	})
})

describe('consultation-investigation — any other main line', () => {
	it.each([
		['Opus', OPUS],
		['an unnamed model', undefined],
	])('lets every broad call through on %s', (_case, model) => {
		expect(delivered(model, 'Read', { file_path: ONE_FILE })).toBeUndefined()
		expect(delivered(model, 'Bash', { command: TREE_GREP })).toBeUndefined()
		expect(delivered(model, 'Glob', { pattern: '**/*.ts' })).toBeUndefined()
	})
})

describe('consultation-investigation-codex — a Codex main line', () => {
	it('refuses a recursive grep on Astra', () => {
		expect(codex_delivered(ASTRA, TREE_GREP)).toBe(CODEX_ROW.reason)
	})

	it('lets a recursive grep through on Sol', () => {
		expect(codex_delivered(SOL, TREE_GREP)).toBeUndefined()
	})

	it('names a Codex subagent on Sol', () => {
		expect(CODEX_ROW.reason).toContain(`a Codex subagent on \`${SOL}\``)
	})
})
