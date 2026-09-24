import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { edit_files_cli } from './edit-files-cli'

// `edit:files` folds several content-addressed edits into one call, the write-side counterpart of
// `read:files` (joshuafolkken/kit#2366). The suite writes a plan and a target under a temp root and
// reads the file back, so the apply, the per-file atomicity and the failure reports are pinned against
// real disk rather than a mock. Every literal is kept short so no two edits share the same code line.

const PLAN = 'plan.txt'
const DEPENDENT_REPORT = 'dependent a.ts'
const NO_MATCH_REPORT = 'no match a.ts'

function root(): string {
	return mkdtempSync(path.join(tmpdir(), 'edit-files-'))
}

function write(directory: string, name: string, text: string): void {
	writeFileSync(path.join(directory, name), text)
}

function read(directory: string, name: string): string {
	return readFileSync(path.join(directory, name), 'utf8')
}

function block(file: string, old: string, next: string): string {
	return `===== ${file} =====\n<<<<<<< OLD\n${old}\n=======\n${next}\n>>>>>>> NEW`
}

function plan(directory: string, ...blocks: Array<string>): void {
	write(directory, PLAN, blocks.join('\n'))
}

function run(directory: string): number {
	return edit_files_cli.run([PLAN], directory)
}

function mute(channel: 'info' | 'error'): MockInstance {
	return vi.spyOn(console, channel).mockImplementation(() => undefined)
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe('edit_files_cli.run applies edits', () => {
	it('across several files in one call', () => {
		const directory = root()

		write(directory, 'a.ts', 'A1\n')
		write(directory, 'b.ts', 'B1\n')
		plan(directory, block('a.ts', 'A1', 'A9'), block('b.ts', 'B1', 'B5'))

		expect(run(directory)).toBe(0)
		expect(read(directory, 'a.ts')).toBe('A9\n')
		expect(read(directory, 'b.ts')).toBe('B5\n')
	})

	it('to one file in the order written', () => {
		const directory = root()

		write(directory, 'a.ts', 'one\ntwo\n')
		plan(directory, block('a.ts', 'one', 'ONE'), block('a.ts', 'two', 'TWO'))

		expect(run(directory)).toBe(0)
		expect(read(directory, 'a.ts')).toBe('ONE\nTWO\n')
	})
})

describe('edit_files_cli.run reports failures without corrupting', () => {
	it('names a no-match edit and leaves the file untouched', () => {
		const directory = root()

		write(directory, 'a.ts', 'kept\n')
		plan(directory, block('a.ts', 'gone', 'X'))
		const info = mute('info')

		expect(run(directory)).toBe(1)
		expect(read(directory, 'a.ts')).toBe('kept\n')
		expect(info).toHaveBeenCalledWith(NO_MATCH_REPORT)
	})

	it('names an ambiguous edit by its match count', () => {
		const directory = root()

		write(directory, 'a.ts', 'x\nx\n')
		plan(directory, block('a.ts', 'x', 'y'))
		const info = mute('info')

		expect(run(directory)).toBe(1)
		expect(info).toHaveBeenCalledWith('ambiguous (2) a.ts')
	})

	it('leaves a file untouched when one of its edits fails', () => {
		const directory = root()

		write(directory, 'a.ts', 'keep\nhit\n')
		plan(directory, block('a.ts', 'hit', 'HIT'), block('a.ts', 'nope', 'X'))
		mute('info')

		expect(run(directory)).toBe(1)
		expect(read(directory, 'a.ts')).toBe('keep\nhit\n')
	})

	it('names a missing target file', () => {
		const directory = root()

		plan(directory, block('gone.ts', 'a', 'b'))
		const info = mute('info')

		expect(run(directory)).toBe(1)
		expect(info).toHaveBeenCalledWith('missing gone.ts')
	})
})

describe('edit_files_cli.run folds only independent edits', () => {
	it('refuses an edit that addresses text an earlier edit wrote', () => {
		const directory = root()

		write(directory, 'a.ts', 'one\n')
		plan(directory, block('a.ts', 'one', 'two'), block('a.ts', 'two', 'three'))
		const info = mute('info')

		expect(run(directory)).toBe(1)
		expect(read(directory, 'a.ts')).toBe('one\n')
		expect(info).toHaveBeenCalledWith(DEPENDENT_REPORT)
	})

	it('refuses an edit whose text an earlier edit removed', () => {
		const directory = root()

		write(directory, 'a.ts', 'one two\n')
		plan(directory, block('a.ts', 'one two', 'x'), block('a.ts', 'two', 'y'))
		const info = mute('info')

		expect(run(directory)).toBe(1)
		expect(read(directory, 'a.ts')).toBe('one two\n')
		expect(info).toHaveBeenCalledWith(DEPENDENT_REPORT)
	})

	it('refuses an edit whose text an earlier edit re-created', () => {
		const directory = root()

		write(directory, 'a.ts', 'f()\n')
		plan(directory, block('a.ts', 'f()', 'try { f() }'), block('a.ts', 'f()', 'g()'))
		const info = mute('info')

		expect(run(directory)).toBe(1)
		expect(read(directory, 'a.ts')).toBe('f()\n')
		expect(info).toHaveBeenCalledWith(DEPENDENT_REPORT)
	})
})

describe('edit_files_cli.run keeps a plain miss apart from a dependent edit', () => {
	it('names a no-match edit after an earlier edit as no match', () => {
		const directory = root()

		write(directory, 'a.ts', 'abc\n')
		plan(directory, block('a.ts', 'abc', 'X'), block('a.ts', 'zz', 'Y'))
		const info = mute('info')

		expect(run(directory)).toBe(1)
		expect(info).toHaveBeenCalledWith(NO_MATCH_REPORT)
	})

	it('lets an ambiguous edit claim no range for a later edit', () => {
		const directory = root()

		write(directory, 'a.ts', 'x = 1; x = 2\n')
		plan(directory, block('a.ts', 'x', 'y'), block('a.ts', 'x = 1', 'z'))
		const info = mute('info')

		expect(run(directory)).toBe(1)
		expect(info).toHaveBeenCalledWith('applied a.ts')
	})
})

describe('edit_files_cli.run reads the plan from standard input', () => {
	it('applies edits across files without a plan file', () => {
		const directory = root()
		const input = [block('a.ts', 'A1', 'A2'), block('b.ts', 'B1', 'B2')].join('\n')

		write(directory, 'a.ts', 'A1\n')
		write(directory, 'b.ts', 'B1\n')

		expect(edit_files_cli.run(['-'], directory, () => input)).toBe(0)
		expect(read(directory, 'a.ts')).toBe('A2\n')
		expect(read(directory, 'b.ts')).toBe('B2\n')
	})

	it('fails on empty standard input', () => {
		const error = mute('error')

		expect(edit_files_cli.run(['-'], root(), () => '')).toBe(1)
		expect(error).toHaveBeenCalledWith('No edit blocks in -')
	})
})

describe('edit_files_cli.run refuses an empty request', () => {
	it('fails on a plan with no edit blocks', () => {
		const directory = root()

		write(directory, PLAN, 'nothing here\n')
		const error = mute('error')

		expect(run(directory)).toBe(1)
		expect(error).toHaveBeenCalledWith(`No edit blocks in ${PLAN}`)
	})

	it('fails with usage when no plan path is given', () => {
		const error = mute('error')

		expect(edit_files_cli.run([], root())).toBe(1)
		expect(error).toHaveBeenCalledWith(edit_files_cli.USAGE)
	})
})

describe('edit_files_cli.parse_plan', () => {
	it('reads every block as one edit, in written order', () => {
		const specs = edit_files_cli.parse_plan(
			[block('a.ts', 'p', 'q'), block('b.ts', 'r', 's')].join('\n'),
		)

		expect(specs).toEqual([
			{ path: 'a.ts', old: 'p', new: 'q' },
			{ path: 'b.ts', old: 'r', new: 's' },
		])
	})
})
