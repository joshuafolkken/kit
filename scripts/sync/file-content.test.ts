import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { file_content } from './file-content'

const ROOT = mkdtempSync(path.join(tmpdir(), 'sync-content-'))
const DESTINATION = path.join(ROOT, 'file.txt')
const WRITE_ONLY_MODE = 0o200
const READ_WRITE_MODE = 0o600
const NEW_CONTENT = 'new content'

afterEach(() => {
	chmodSync(DESTINATION, READ_WRITE_MODE)
	rmSync(DESTINATION)
})

it('updates a write-only destination when its previous content cannot be compared', () => {
	writeFileSync(DESTINATION, 'old content')
	chmodSync(DESTINATION, WRITE_ONLY_MODE)

	expect(file_content.write_text_if_changed(DESTINATION, NEW_CONTENT)).toBe(true)
	chmodSync(DESTINATION, READ_WRITE_MODE)
	expect(readFileSync(DESTINATION, 'utf8')).toBe(NEW_CONTENT)
})
