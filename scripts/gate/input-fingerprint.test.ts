import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { stamp_file } from '#scripts/josh/stamp-file'
import { afterAll, describe, expect, it } from 'vitest'
import { input_fingerprint } from './input-fingerprint'

const root = mkdtempSync(path.join(tmpdir(), 'kit-input-fingerprint-'))
const PRESENT = 'present.txt'
const MISSING = 'missing.txt'
const CONTENT = 'content\n'

writeFileSync(path.join(root, PRESENT), CONTENT)

afterAll(() => {
	rmSync(root, { recursive: true, force: true })
})

describe('input_fingerprint.of_entries', () => {
	it('answers the same digest whatever the order', () => {
		expect(input_fingerprint.of_entries(['b', 'a'])).toBe(input_fingerprint.of_entries(['a', 'b']))
	})

	it('answers another digest when an entry moves', () => {
		expect(input_fingerprint.of_entries(['a', 'b'])).not.toBe(
			input_fingerprint.of_entries(['a', 'c']),
		)
	})
})

describe('input_fingerprint.of_files', () => {
	it('keys each path to the digest of its content, the absent marker for a missing one', () => {
		expect(input_fingerprint.of_files(root, [MISSING, PRESENT])).toStrictEqual({
			[MISSING]: input_fingerprint.ABSENT,
			[PRESENT]: stamp_file.digest(CONTENT),
		})
	})

	it('lists the paths sorted, so two readings of one tree compare byte for byte', () => {
		expect(Object.keys(input_fingerprint.of_files(root, [PRESENT, MISSING]))).toStrictEqual([
			MISSING,
			PRESENT,
		])
	})
})
