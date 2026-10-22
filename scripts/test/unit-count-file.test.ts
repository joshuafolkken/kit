import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { unit_count_file } from './unit-count-file'

// joshuafolkken/kit#4465: `josh test:related` reads the run's test-file count from a file it names.

const COUNT = 25

const scratch = mkdtempSync(path.join(tmpdir(), 'unit-count-file-test-'))

afterAll(() => {
	rmSync(scratch, { recursive: true, force: true })
})

describe('unit_count_file.write_count — the reporter side', () => {
	it('writes the count to the named file', async () => {
		const target = path.join(scratch, 'written')

		await unit_count_file.write_count(COUNT, target)

		expect(readFileSync(target, 'utf8')).toBe(String(COUNT))
	})

	it.each([undefined, ''])('writes nothing when no file is named (%j)', async (target) => {
		const before = readdirSync(scratch)
		const working_before = readdirSync(process.cwd())

		await unit_count_file.write_count(COUNT, target)

		expect(readdirSync(scratch)).toEqual(before)
		expect(readdirSync(process.cwd())).toEqual(working_before)
	})

	it('does not throw when the file cannot be written', async () => {
		const target = path.join(scratch, 'missing', 'count')

		await expect(unit_count_file.write_count(COUNT, target)).resolves.toBeUndefined()
		expect(existsSync(target)).toBe(false)
	})
})

describe('unit_count_file.read_count — the caller side', () => {
	it('reads back the count written', async () => {
		const target = path.join(scratch, 'read')

		await unit_count_file.write_count(COUNT, target)

		expect(unit_count_file.read_count(target)).toBe(COUNT)
	})

	it('answers no count for a missing file', () => {
		expect(unit_count_file.read_count(path.join(scratch, 'absent'))).toBeUndefined()
	})

	it.each(['', 'not a count'])('answers no count for unreadable content (%j)', (content) => {
		const target = path.join(scratch, 'unreadable')

		writeFileSync(target, content)

		expect(unit_count_file.read_count(target)).toBeUndefined()
	})
})
