import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { cli_body } from './cli-body'

// joshuafolkken/kit#1198: an Issue or PR body handed to a command inside shell double quotes is
// evaluated before the command runs — a backtick runs as command substitution, and the substituted
// text is what reaches GitHub. A PR comment posted that way had part of its own words run as git
// commands. The file route exists so the shell never sees the body at all, and these cases pin that
// a body full of exactly those characters survives it byte for byte.
const WORK_DIRECTORY = mkdtempSync(path.join(tmpdir(), 'cli-body-'))
// The flag pair every case resolves under. Named so a case cannot silently test a different pairing
// from the one the error message is asserted against.
const INLINE_FLAG = '--body'
const FILE_FLAG = '--body-file'

// Every character the measurement in `prompts/collaboration-workflow/shell-body.md` found dangerous,
// in the shape a real completion report carries them.
const DANGEROUS_BODY = [
	'Cause: `pnpm josh ms` switched the work tree, because `owner/repo#` was substituted.',
	'Fix: pass $HOME-relative paths and `--body-file` instead.',
	'Result: `josh notify --body-file` ships it. Done!',
].join('\n')

function write_body(name: string, text: string): string {
	const target = path.join(WORK_DIRECTORY, name)

	writeFileSync(target, text)

	return target
}

afterAll(() => {
	rmSync(WORK_DIRECTORY, { recursive: true, force: true })
})

describe('cli_body.resolve — the file route', () => {
	it('carries a body of backticks and dollars through unchanged', () => {
		const file_path = write_body('dangerous.md', DANGEROUS_BODY)

		expect(
			cli_body.resolve({
				inline: undefined,
				file_path,
				inline_flag: INLINE_FLAG,
				file_flag: FILE_FLAG,
			}),
		).toBe(DANGEROUS_BODY)
	})

	// A file already holds real newlines, so an escape sequence in one is the author's text. Expanding
	// it — which is what the inline form needs — would rewrite a body nobody asked to have rewritten.
	it('leaves a literal backslash-n in a file body alone', () => {
		const file_path = write_body('escape.md', String.raw`line1\nline2`)

		expect(
			cli_body.resolve({
				inline: undefined,
				file_path,
				inline_flag: INLINE_FLAG,
				file_flag: FILE_FLAG,
			}),
		).toBe(String.raw`line1\nline2`)
	})
})

describe('cli_body.resolve — the inline route', () => {
	it('expands the escape the inline form needs to stay one shell token', () => {
		expect(
			cli_body.resolve({
				inline: String.raw`line1\nline2`,
				file_path: undefined,
				inline_flag: INLINE_FLAG,
				file_flag: FILE_FLAG,
			}),
		).toBe('line1\nline2')
	})

	it('answers undefined when neither flag was given', () => {
		expect(
			cli_body.resolve({
				inline: undefined,
				file_path: undefined,
				inline_flag: INLINE_FLAG,
				file_flag: FILE_FLAG,
			}),
		).toBeUndefined()
	})

	// An empty file path is not an answer, so the inline value still wins rather than the reader being
	// handed `''` to open.
	it('reads the inline value when the file flag carries no path', () => {
		expect(
			cli_body.resolve({
				inline: 'done',
				file_path: '',
				inline_flag: INLINE_FLAG,
				file_flag: FILE_FLAG,
			}),
		).toBe('done')
	})
})

// **Refused rather than ranked**: a precedence rule would let a caller that meant the file silently
// ship the inline string it was trying to get away from — the exact failure the file route removes.
describe('cli_body.resolve — both flags at once', () => {
	it('refuses, naming both flags', () => {
		expect(() =>
			cli_body.resolve({
				inline: 'done',
				file_path: write_body('both.md', 'done'),
				inline_flag: '--notify-message',
				file_flag: '--notify-message-file',
			}),
		).toThrow('Pass --notify-message or --notify-message-file, not both.')
	})
})

describe('cli_body.has_value', () => {
	it.each([
		[undefined, false],
		['', false],
		['x', true],
	])('reads %j as %j', (raw, expected) => {
		expect(cli_body.has_value(raw)).toBe(expected)
	})
})
