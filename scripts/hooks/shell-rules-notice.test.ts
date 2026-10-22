import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { shell_rules_notice } from './shell-rules-notice'

// Below `step-zero-notice.test.ts`'s ceiling: the notice is injected text, delivered once.
const NOTICE_CEILING_BYTES = 256

const created: Array<string> = []

afterEach(() => {
	for (const transcript of created.splice(0)) {
		rmSync(shell_rules_notice.stamp_path(transcript), { force: true })
		rmSync(path.dirname(transcript), { recursive: true, force: true })
	}
})

// A fresh transcript per case, so the once-per-session stamp never dedupes one case against another.
function fresh_transcript(): string {
	const directory = mkdtempSync(path.join(tmpdir(), 'shell-rules-'))
	const transcript = path.join(directory, 'transcript.jsonl')

	created.push(transcript)

	return transcript
}

function payload(tool_name: string, tool_input: unknown, transcript_path: string): string {
	return JSON.stringify({ tool_name, tool_input, transcript_path })
}

function bash(command: string, transcript: string): string {
	return payload('Bash', { command }, transcript)
}

describe('shell_rules_notice — when it speaks', () => {
	it('delivers the rules on the first Bash call of a session', () => {
		const first_call = bash('ls', fresh_transcript())

		expect(shell_rules_notice.notice(first_call)).toBe(shell_rules_notice.NOTICE)
	})

	it('speaks once per session, not on every call', () => {
		const transcript = fresh_transcript()

		expect(shell_rules_notice.notice(bash('ls', transcript))).toBeDefined()
		expect(shell_rules_notice.notice(bash('git status', transcript))).toBeUndefined()
	})

	it.each(['Edit', 'Read', 'Write'])(
		'stays silent, without spending its stamp, on a %s call',
		(tool_name) => {
			const transcript = fresh_transcript()

			expect(
				shell_rules_notice.notice(payload(tool_name, { file_path: '/repo/a.ts' }, transcript)),
			).toBeUndefined()
			expect(shell_rules_notice.notice(bash('ls', transcript))).toBeDefined()
		},
	)

	it('stays silent on a payload it cannot read', () => {
		expect(shell_rules_notice.notice('{}')).toBeUndefined()
	})
})

describe('shell_rules_notice — what it says', () => {
	it.each([
		'Edit or Write',
		'never a script or heredoc that writes it',
		'file-edits.md',
		'with no pipe',
		'set -o pipefail',
		'never `| head`',
		'output-bounds.md',
	])('states %j', (directive) => {
		expect(shell_rules_notice.NOTICE).toContain(directive)
	})

	it('stays under the injected-text ceiling', () => {
		expect(Buffer.byteLength(shell_rules_notice.NOTICE, 'utf8')).toBeLessThan(NOTICE_CEILING_BYTES)
	})
})
