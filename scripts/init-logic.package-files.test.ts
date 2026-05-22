import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { init_logic } from './init-logic'

const PACKAGE_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const PACKAGE_JSON_PATH = path.join(PACKAGE_ROOT, 'package.json')
const PACKAGE_JSON = JSON.parse(readFileSync(PACKAGE_JSON_PATH, 'utf8')) as {
	files: ReadonlyArray<string>
}
const POSITIVE_FILES_ENTRIES: ReadonlyArray<string> = PACKAGE_JSON.files.filter(
	(entry) => !entry.startsWith('!'),
)

function is_covered_by_files_array(source_path: string): boolean {
	return POSITIVE_FILES_ENTRIES.some(
		(entry) => source_path === entry || source_path.startsWith(`${entry}/`),
	)
}

describe('package.json files covers all AI copy sources', () => {
	it.each(init_logic.get_ai_copy_files())(
		'covers ai copy file %s with a top-level files entry',
		(filename) => {
			expect(is_covered_by_files_array(filename)).toBe(true)
		},
	)

	it.each(init_logic.get_ai_copy_file_mappings())(
		'covers ai copy mapping src $src with a top-level files entry',
		({ src }) => {
			expect(is_covered_by_files_array(src)).toBe(true)
		},
	)

	it.each(init_logic.get_ai_copy_directories())(
		'covers ai copy directory %s with a top-level files entry',
		(directory) => {
			expect(is_covered_by_files_array(directory)).toBe(true)
		},
	)
})
