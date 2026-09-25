import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	utimesSync,
	writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { copy_directory_failure } from './directory-copy-guard'

const ROOT = mkdtempSync(path.join(tmpdir(), 'sync-directory-'))
const SOURCE = path.join(ROOT, 'source')
const DESTINATION = path.join(ROOT, 'consumer')
const OLD_DATE = new Date('2020-01-01T00:00:00Z')
const SKILL_FILE = 'SKILL.md'
const BINARY_FILE = 'diagram.bin'
const CONSUMER_NOTE = 'consumer.md'

function seed_directory(): void {
	mkdirSync(SOURCE, { recursive: true })
	writeFileSync(path.join(SOURCE, SKILL_FILE), 'see `prompts/review.md`\n')
	writeFileSync(path.join(SOURCE, BINARY_FILE), 'binary content')
}

afterEach(() => {
	rmSync(SOURCE, { recursive: true, force: true })
	rmSync(DESTINATION, { recursive: true, force: true })
})

describe('directory copy', () => {
	it('keeps timestamps and consumer files on a repeated copy', () => {
		seed_directory()
		expect(copy_directory_failure(SOURCE, DESTINATION)).toBeUndefined()
		const skill = path.join(DESTINATION, SKILL_FILE)
		const binary = path.join(DESTINATION, BINARY_FILE)

		writeFileSync(path.join(DESTINATION, CONSUMER_NOTE), 'keep me')
		utimesSync(skill, OLD_DATE, OLD_DATE)
		utimesSync(binary, OLD_DATE, OLD_DATE)
		let did_change = true

		copy_directory_failure(SOURCE, DESTINATION, (changed) => {
			did_change = changed
		})
		expect([
			did_change,
			statSync(skill).mtimeMs,
			statSync(binary).mtimeMs,
			readFileSync(path.join(DESTINATION, CONSUMER_NOTE), 'utf8'),
		]).toStrictEqual([false, OLD_DATE.getTime(), OLD_DATE.getTime(), 'keep me'])
	})

	it('updates only a changed distributed file', () => {
		mkdirSync(SOURCE, { recursive: true })
		writeFileSync(path.join(SOURCE, 'SKILL.md'), 'first\n')
		writeFileSync(path.join(SOURCE, 'other.md'), 'keep\n')
		copy_directory_failure(SOURCE, DESTINATION)
		utimesSync(path.join(DESTINATION, 'other.md'), OLD_DATE, OLD_DATE)
		writeFileSync(path.join(SOURCE, 'SKILL.md'), 'second\n')

		expect(copy_directory_failure(SOURCE, DESTINATION)).toBeUndefined()
		expect(readFileSync(path.join(DESTINATION, 'SKILL.md'), 'utf8')).toBe('second\n')
		expect(statSync(path.join(DESTINATION, 'other.md')).mtimeMs).toBe(OLD_DATE.getTime())
	})
})

describe('directory copy guards', () => {
	it('keeps an empty destination directory unchanged', () => {
		mkdirSync(SOURCE, { recursive: true })
		mkdirSync(DESTINATION, { recursive: true })
		let did_change = true

		expect(
			copy_directory_failure(SOURCE, DESTINATION, (changed) => {
				did_change = changed
			}),
		).toBeUndefined()
		expect(did_change).toBe(false)
	})

	it('reports a nested type conflict without replacing the consumer directory', () => {
		mkdirSync(SOURCE, { recursive: true })
		mkdirSync(path.join(DESTINATION, SKILL_FILE), { recursive: true })
		writeFileSync(path.join(SOURCE, SKILL_FILE), 'distributed\n')

		expect(copy_directory_failure(SOURCE, DESTINATION)).toContain('copy failed')
		expect(statSync(path.join(DESTINATION, SKILL_FILE)).isDirectory()).toBe(true)
	})
})
