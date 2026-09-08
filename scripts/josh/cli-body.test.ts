import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { devNull, tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { cli_body } from './cli-body'

// The one export this file replaces, in the shape `cli_body` calls it. The rest of `node:fs` is
// spread through untouched at run time — only the type is narrowed to what is being wrapped.
interface FsReader {
	readFileSync: (target: number | string, encoding: BufferEncoding) => string
}

// **The stdin form cannot be exercised through the runner's own descriptor 0.** A vitest worker
// inherits it, so reading it would block on a terminal or an open pipe and hang the suite. The read
// is wrapped instead: descriptor 0 answers with a known body and every path-shaped read still reaches
// the real file system, so what is pinned is the one thing `-` decides — file or descriptor.
const STDIN = vi.hoisted(() => ({ BODY: 'a body piped in\n', FD: 0 }))

vi.mock('node:fs', async (import_original) => {
	const actual = await import_original<FsReader>()

	function read_file_sync(target: number | string, encoding: BufferEncoding): string {
		return target === STDIN.FD ? STDIN.BODY : actual.readFileSync(target, encoding)
	}

	return { ...actual, readFileSync: read_file_sync }
})

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
// The shortest body a case can carry when what it pins is the route rather than the text.
const DONE = 'done'
// What `\nline1\nline2\n` expands to — assembled from its lines rather than written as a literal, so
// the expected value cannot be read as the same token as the escaped input beside it. The newlines at
// either end are the ones a downstream `trim` used to eat.
const EDGE_NEWLINES = ['', 'line1', 'line2', ''].join('\n')

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

	// The promise `gh issue create --body-file -` makes, and the reason the reader is one module: `-`
	// has to mean the same thing under `--body-file`, `--notify-message-file`, `--rationale-file` and
	// `--decision-file`. `prompts/collaboration-workflow/shell-body.md` states it, and nothing pinned
	// it until this case.
	it('reads standard input when the path is `-`', () => {
		expect(cli_body.read_file_or_stdin('-')).toBe(STDIN.BODY)
	})

	// The negative control for the same decision: an ordinary path must still be opened as a path
	// rather than answered from the descriptor.
	it('opens a path that is not `-` as a file', () => {
		expect(cli_body.read_file_or_stdin(write_body('ordinary.md', DONE))).toBe(DONE)
	})

	// **Readable, and not a regular file.** `epic --rationale-file` accepted any readable path before
	// this reader existed, and the spellings a run reaches for are not regular files: `/dev/stdin` is a
	// device, and a `<(…)` process substitution arrives as a FIFO. An `isFile()` check refuses both
	// with `Not a readable file`, which is a regression wearing a guard's clothes.
	it('opens a readable path that is not a regular file', () => {
		expect(cli_body.read_file_or_stdin(devNull)).toBe('')
	})
})

// **Trim first, expand second.** `git_notify` used to run `raw.trim().replaceAll(…)` in one
// expression; moving only the expansion here left a trim downstream of it, and a body written
// `--notify-message "…\n"` had the newline its own escape had just produced eaten as surrounding
// whitespace. These two cases are the pair: the quoting slack goes, the escape's newlines stay.
describe('cli_body.resolve — the order the inline route reads in', () => {
	it('trims the surrounding whitespace a shell token picks up', () => {
		expect(
			cli_body.resolve({
				inline: '  done  ',
				file_path: undefined,
				inline_flag: INLINE_FLAG,
				file_flag: FILE_FLAG,
			}),
		).toBe(DONE)
	})

	it('keeps the newlines the escape produces at either end', () => {
		expect(
			cli_body.resolve({
				inline: String.raw`\nline1\nline2\n`,
				file_path: undefined,
				inline_flag: INLINE_FLAG,
				file_flag: FILE_FLAG,
			}),
		).toBe(EDGE_NEWLINES)
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
				inline: DONE,
				file_path: '',
				inline_flag: INLINE_FLAG,
				file_flag: FILE_FLAG,
			}),
		).toBe(DONE)
	})
})

// **Refused rather than ranked**: a precedence rule would let a caller that meant the file silently
// ship the inline string it was trying to get away from — the exact failure the file route removes.
describe('cli_body.resolve — both flags at once', () => {
	it('refuses, naming both flags', () => {
		expect(() =>
			cli_body.resolve({
				inline: DONE,
				file_path: write_body('both.md', DONE),
				inline_flag: '--notify-message',
				file_flag: '--notify-message-file',
			}),
		).toThrow('Pass --notify-message or --notify-message-file, not both.')
	})
})

// The path arrives from a command line, so a wrong one must fail legibly rather than reaching the
// file system unexamined and dying on a raw `ENOENT` in the middle of a merge.
describe('cli_body.resolve — a path that names no file', () => {
	// A missing file and a directory: the two ways a path can exist as a string and name nothing this
	// reader can open.
	it.each([path.join(WORK_DIRECTORY, 'absent.md'), WORK_DIRECTORY])(
		'refuses %j, naming the resolved path',
		(file_path) => {
			expect(() =>
				cli_body.resolve({
					inline: undefined,
					file_path,
					inline_flag: INLINE_FLAG,
					file_flag: FILE_FLAG,
				}),
			).toThrow('Not a readable file')
		},
	)
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
