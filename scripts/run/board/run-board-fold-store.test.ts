import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_fold_store } from './run-board-fold-store'

// joshuafolkken/kit#7213: a live board's folds are kept across launches in one account-wide file, and
// a missing, broken or foreign file restores what it can without stopping the board.

const { file_store } = run_board_fold_store
const make_directory = temporary_directory()
const FILE_NAME = 'board.json'
const PREFIX = 'run-board-fold-store-'

afterEach(() => {
	vi.unstubAllEnvs()
})

function board_file(directory = make_directory(PREFIX)): string {
	return path.join(directory, 'josh', FILE_NAME)
}

function written(content: string): string {
	const file = board_file()

	mkdirSync(path.dirname(file), { recursive: true })
	writeFileSync(file, content)

	return file
}

describe('run_board_fold_store.file_store', () => {
	it('loads the folds it saved, by section name', () => {
		const file = board_file()

		file_store(file).save(new Set(['usage', 'done']))
		expect(JSON.parse(readFileSync(file, 'utf8'))).toStrictEqual({ folded: ['usage', 'done'] })
		expect([...file_store(file).load()]).toStrictEqual(['usage', 'done'])
	})

	it('loads every section open when no file is there', () => {
		expect(file_store(board_file()).load().size).toBe(0)
	})

	it.each(['{ not json', '["usage"]', '{ "folded": "usage" }'])(
		'loads every section open from a broken or misshapen file: %s',
		(content) => {
			expect(file_store(written(content)).load().size).toBe(0)
		},
	)

	it('drops the section names it does not know', () => {
		const file = written(JSON.stringify({ folded: ['usage', 'nonsense', 1, 'lanes'] }))

		expect([...file_store(file).load()]).toStrictEqual(['usage', 'lanes'])
	})

	it('keeps the board drawing when the save cannot be written', () => {
		const blocked = path.join(written(''), FILE_NAME)

		expect(() => {
			file_store(blocked).save(new Set(['usage']))
		}).not.toThrow()
	})

	it('saves under the Claude configuration directory by default', () => {
		const directory = make_directory(PREFIX)

		vi.stubEnv('CLAUDE_CONFIG_DIR', directory)
		file_store().save(new Set(['queued']))
		expect([...file_store(board_file(directory)).load()]).toStrictEqual(['queued'])
	})
})
