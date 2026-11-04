import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { delivered_rules } from './delivered-rules'
import { investigator_foreground } from './investigator-foreground'

const DIRECTORY = mkdtempSync(path.join(tmpdir(), 'investigator-entrypoint-'))
const VS_CODE = 'claude-vscode'
const REASON = investigator_foreground.ROW.reason

afterAll(() => {
	rmSync(DIRECTORY, { recursive: true, force: true })
})

afterEach(() => {
	vi.unstubAllEnvs()
})

describe('investigator foreground on the first dispatch', () => {
	it.each([
		[VS_CODE, undefined, undefined],
		[VS_CODE, true, REASON],
		['cli', undefined, REASON],
		['unknown', undefined, REASON],
		['', undefined, REASON],
	])('checks first dispatch for %s with background=%s', (entrypoint, background, expected) => {
		const transcript = path.join(DIRECTORY, `${entrypoint}-${String(background)}.jsonl`)
		const tool_input = { subagent_type: 'investigator', run_in_background: background }
		const payload = { transcript_path: transcript, tool_name: 'Agent', tool_input }

		vi.stubEnv('CLAUDE_CODE_ENTRYPOINT', entrypoint)
		writeFileSync(transcript, '')

		expect(delivered_rules.delivery(JSON.stringify(payload))).toBe(expected)
	})
})
