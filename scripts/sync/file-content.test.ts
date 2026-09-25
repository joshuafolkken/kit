import { mkdtempSync, rmSync, writeFileSync, type readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { file_content } from './file-content'

const read_file_sync_mock = vi.hoisted(() => vi.fn())

vi.mock('node:fs', async (import_original) => ({
	...(await import_original<{ readFileSync: typeof readFileSync }>()),
	readFileSync: read_file_sync_mock,
}))

const actual_fs = await vi.importActual<{ readFileSync: typeof readFileSync }>('node:fs')
const ROOT = mkdtempSync(path.join(tmpdir(), 'sync-content-'))
const DESTINATION = path.join(ROOT, 'file.txt')
const NEW_CONTENT = 'new content'

afterEach(() => {
	rmSync(DESTINATION)
	read_file_sync_mock.mockReset()
})

it.each(['EACCES', 'EPERM'])('writes when reading the destination fails with %s', (code) => {
	writeFileSync(DESTINATION, 'old content')
	read_file_sync_mock.mockImplementation(() => {
		throw Object.assign(new Error('read denied'), { code })
	})

	expect(file_content.write_text_if_changed(DESTINATION, NEW_CONTENT)).toBe(true)
	expect(actual_fs.readFileSync(DESTINATION, 'utf8')).toBe(NEW_CONTENT)
})
