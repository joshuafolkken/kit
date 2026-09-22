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
		expect(info).toHaveBeenCalledWith('no match a.ts')
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
