import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { time_transcript_fixture } from '#tools/time/time-transcript-fixture'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { delivered_rules } from './delivered-rules'
import { hook_context_line } from './hook-context-line'
import { issue_comments } from './issue-comments'
import { piped_verification } from './piped-verification'
import { rule_rewrite } from './rule-rewrite'
import { rule_value_fixture } from './rule-value-fixture'

// The call a `PreToolUse` hook runs in place of a mechanically fixable refusal (joshuafolkken/kit#3920).
// The hook's envelope is pinned in `pretool-guard.test.ts`; this suite pins the input each row makes.

const BASH = 'Bash'
const BODY_READ = 'gh api repos/o/r/issues/7 --jq .body'
const COMMENTS_READ = 'gh api --paginate repos/o/r/issues/7/comments --jq'
const PIPED_LINT = 'pnpm josh lint:related 2>&1 | tail -5'
const DESCRIPTION = 'Read the Issue'
const TRANSCRIPT_FILE = 'transcript.jsonl'
const COMMENTS_TAIL = time_transcript_fixture.josh_call_line(
	0,
	time_transcript_fixture.BRANCH,
	`${COMMENTS_READ} .`,
)

function no_tail(): string {
	return ''
}

function comments_tail(): string {
	return COMMENTS_TAIL
}

function transcript(lines: ReadonlyArray<string>): string {
	const directory = mkdtempSync(path.join(tmpdir(), 'rule-rewrite-'))
	const transcript_path = path.join(directory, TRANSCRIPT_FILE)

	writeFileSync(transcript_path, `${['{"type":"user"}', ...lines].join('\n')}\n`)

	return transcript_path
}

function bash_payload(command: string, transcript_path = transcript([])): string {
	return JSON.stringify({ tool_name: BASH, tool_input: { command }, transcript_path })
}

afterEach(() => {
	vi.unstubAllEnvs()
})

describe('issue_comments.comments_input', () => {
	it("prepends the same Issue's comments read, keeping the typed line last and the other fields", () => {
		const input = { command: BODY_READ, description: DESCRIPTION }
		const rewritten = issue_comments.comments_input({ name: BASH, input }, no_tail)

		expect(rewritten?.['description']).toBe(DESCRIPTION)
		expect(String(rewritten?.['command'])).toMatch(
			new RegExp(String.raw`^${COMMENTS_READ} .*\n${BODY_READ}$`, 'u'),
		)
	})

	it('rewrites nothing once the comments are on the tail', () => {
		const call = { name: BASH, input: { command: BODY_READ } }

		expect(issue_comments.comments_input(call, comments_tail)).toBeUndefined()
	})

	it('rewrites nothing for `gh issue view` or a non-Bash call', () => {
		const view = { name: BASH, input: { command: 'gh issue view 7' } }
		const read = { name: 'Read', input: { file_path: 'a.ts' } }

		expect(issue_comments.comments_input(view, no_tail)).toBeUndefined()
		expect(issue_comments.comments_input(read, no_tail)).toBeUndefined()
	})
})

describe('issue_comments.comments_input — where the line opens', () => {
	// A prepended read would run in another cwd than the body read, or run text that was only quoted.
	it.each([
		[`cd ../other && ${BODY_READ}`],
		[`(${BODY_READ})`],
		[`cat > f <<'EOF'\n${BODY_READ}\nEOF`],
		[`echo '${BODY_READ}'`],
	])('rewrites nothing for %j, which does not open with the body read', (command) => {
		expect(
			issue_comments.comments_input({ name: BASH, input: { command } }, no_tail),
		).toBeUndefined()
	})

	it('rewrites a line that opens with the body read and chains on', () => {
		const command = `${BODY_READ} && echo done`
		const rewritten = issue_comments.comments_input({ name: BASH, input: { command } }, no_tail)

		expect(String(rewritten?.['command'])).toMatch(
			new RegExp(String.raw`\n${BODY_READ} && echo done$`, 'u'),
		)
	})
})

describe('rule_rewrite.rewrite', () => {
	it('carries the rewritten input in the payload it returns', () => {
		const rewrite = rule_rewrite.rewrite(bash_payload(BODY_READ))

		expect(rewrite?.note).toBe(issue_comments.COMMENTS_NOTE)
		expect(JSON.parse(rewrite?.payload ?? '{}')).toMatchObject({ tool_input: rewrite?.input })
	})

	it('folds every rewriting row over one line, joining their notes in row order', () => {
		const rewrite = rule_rewrite.rewrite(bash_payload(`${BODY_READ} && ${PIPED_LINT}`))

		expect(String(rewrite?.input['command'])).toContain(`(set -o pipefail; ${PIPED_LINT})`)
		expect(String(rewrite?.input['command'])).toContain(COMMENTS_READ)
		expect(rewrite?.note).toBe(
			`${issue_comments.COMMENTS_NOTE}\n\n${piped_verification.PIPEFAIL_NOTE}`,
		)
	})

	it('rewrites nothing once the comments read is on the transcript', () => {
		const transcript_path = transcript([COMMENTS_TAIL])

		expect(rule_rewrite.rewrite(bash_payload(BODY_READ, transcript_path))).toBeUndefined()
	})

	it('rewrites nothing while the rule guard is switched off', () => {
		vi.stubEnv(delivered_rules.SWITCH_ENV_KEY, 'off')

		expect(rule_rewrite.rewrite(bash_payload(BODY_READ))).toBeUndefined()
	})

	it('reads a transcript it cannot open as an empty tail rather than throwing', () => {
		const missing = path.join(tmpdir(), 'rule-rewrite-missing', TRANSCRIPT_FILE)

		expect(rule_rewrite.rewrite(bash_payload(BODY_READ, missing))?.note).toBe(
			issue_comments.COMMENTS_NOTE,
		)
	})
})

function context_line(content: string): string {
	const attachment = { type: hook_context_line.HOOK_CONTEXT_TYPE, content: [content] }

	return JSON.stringify({ type: 'attachment', timestamp: rule_value_fixture.TIMESTAMP, attachment })
}

describe('rule_value.measure — a folded note', () => {
	it.each(['issue-comments', 'piped-verification'])('credits %s with its rewrite', (id) => {
		const note = rule_rewrite.rewrite(bash_payload(`${BODY_READ} && ${PIPED_LINT}`))?.note ?? ''
		const text = `${rule_value_fixture.session('ls')}\n${context_line(note)}`

		expect(rule_value_fixture.reading_for(id, [[text]]).rewrites).toBe(1)
	})
})
