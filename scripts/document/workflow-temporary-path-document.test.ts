import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// joshuafolkken/kit#6114: every workflow-commands procedure that has a session write a body, brief,
// rationale or memo names `.josh/tmp/` as its path, so nothing lands in an untracked `scratchpad/`.
// The rule itself lives in `shell-body.md`; SKILL.md points at it once.
const DIRECTORY = '.claude/skills/workflow-commands'
const SKILL = path.join(DIRECTORY, 'SKILL.md')
const MARKUP = /[`[\]]/gu
const TEMP_PREFIX = '.josh/tmp/'
// A flag named in a table cell is followed by the cell border, not by an argument.
const NOT_AN_ARGUMENT = new Set(['', '|'])

function is_file_flag(token: string): boolean {
	return token.startsWith('--') && token.endsWith('-file')
}

function document_file_arguments(name: string): Array<[string, string]> {
	const tokens = readFileSync(path.join(DIRECTORY, name), 'utf8')
		.split(/[\s=]+/u)
		.map((token) => token.replaceAll(MARKUP, ''))

	return tokens.flatMap((token, index): Array<[string, string]> => {
		const value = tokens[index + 1]

		return value !== undefined && !NOT_AN_ARGUMENT.has(value) && is_file_flag(token)
			? [[name, value]]
			: []
	})
}

function file_arguments(): Array<[string, string]> {
	const names = readdirSync(DIRECTORY).filter((name) => name.endsWith('.md'))

	return names.flatMap((name) => document_file_arguments(name))
}

describe('workflow-commands name .josh/tmp/ for the files they have a session write', () => {
	it('finds the file arguments it checks', () => {
		expect(file_arguments().length).toBeGreaterThan(0)
	})

	it.each(file_arguments())('%s passes %s under .josh/tmp/', (_name, value) => {
		expect(value.startsWith(TEMP_PREFIX)).toBe(true)
	})

	it('SKILL.md points at shell-body.md as the single source', () => {
		expect(readFileSync(SKILL, 'utf8')).toContain(
			'Write it under `.josh/tmp/` | `prompts/collaboration-workflow/shell-body.md` → "安全な書き方"',
		)
	})
})
