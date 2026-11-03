import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// joshuafolkken/kit#6114: every workflow-commands procedure that has a session write a body, brief,
// rationale or memo names `.josh/tmp/` as its path, so nothing lands in an untracked `scratchpad/`.
// The rule itself lives in `shell-body.md`; SKILL.md points at it once.
const DIRECTORY = '.claude/skills/workflow-commands'
const SKILL = path.join(DIRECTORY, 'SKILL.md')
const OPTIONAL_MARKUP = /[[\]]/gu
const TEMP_PREFIX = '.josh/tmp/'

function is_file_flag(token: string): boolean {
	return token.startsWith('--') && token.endsWith('-file')
}

// Commands live in code spans, so the text between backticks is read and prose is not — a fence's
// three backticks flip the parity once, like one. A flag that opens its span is an option named
// bare (a table cell); anywhere else it is a command, and the token after it is its argument — a
// flag that ends its span reads as an empty argument, so it fails (joshuafolkken/kit#6125).
function code_spans(text: string): Array<string> {
	return text.split('`').filter((_segment, index) => index % 2 === 1)
}

function span_file_arguments(span: string): Array<string> {
	const tokens = span
		.replaceAll(OPTIONAL_MARKUP, '')
		.split(/[\s=]+/u)
		.filter((token) => token !== '')

	return tokens
		.map((token, index) => ({ token, value: tokens[index + 1] ?? '' }))
		.filter((pair, index) => index > 0 && is_file_flag(pair.token))
		.map((pair) => pair.value)
}

function file_arguments(): Array<[string, string]> {
	const names = readdirSync(DIRECTORY).filter((name) => name.endsWith('.md'))

	return names.flatMap((name) =>
		code_spans(readFileSync(path.join(DIRECTORY, name), 'utf8'))
			.flatMap((span) => span_file_arguments(span))
			.map((value): [string, string] => [name, value]),
	)
}

describe('workflow-commands name .josh/tmp/ for the files they have a session write', () => {
	it('finds the file arguments it checks', () => {
		expect(file_arguments().length).toBeGreaterThan(0)
	})

	it.each(file_arguments())('%s passes "%s" under .josh/tmp/', (_name, value) => {
		expect(value.startsWith(TEMP_PREFIX)).toBe(true)
	})

	it('reads a glued --x-file=<path> and a flag that ends its span', () => {
		expect(span_file_arguments('pnpm josh notify --body-file=.josh/tmp/a.md')).toStrictEqual([
			'.josh/tmp/a.md',
		])
		expect(span_file_arguments('gh issue edit <N> --body-file')).toStrictEqual([''])
		expect(span_file_arguments('--notify-message-file')).toStrictEqual([])
	})

	it('SKILL.md points at shell-body.md as the single source', () => {
		expect(readFileSync(SKILL, 'utf8')).toContain(
			'Write it under `.josh/tmp/` | `prompts/collaboration-workflow/shell-body.md` → "安全な書き方"',
		)
	})
})
