import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	symlinkSync,
	writeFileSync,
	type readFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'

const read_file_sync_mock = vi.hoisted(() => vi.fn())

vi.mock('node:fs', async (import_original) => ({
	...(await import_original<{ readFileSync: typeof readFileSync }>()),
	readFileSync: read_file_sync_mock,
}))

const actual_fs = await vi.importActual<{ readFileSync: typeof readFileSync }>('node:fs')
const SANDBOX = mkdtempSync(path.join(tmpdir(), 'sync-content-'))
const ROOT = path.join(SANDBOX, 'project')
const OUTSIDE = path.join(SANDBOX, 'outside')
const DESTINATION = path.join(ROOT, 'file.txt')
const NEW_CONTENT = 'new content'

mkdirSync(ROOT)
mkdirSync(OUTSIDE)
vi.doMock('#scripts/init/init-paths', () => ({ PROJECT_ROOT: ROOT }))

const { file_content } = await import('./file-content')

afterEach(() => {
	rmSync(DESTINATION, { force: true })
	read_file_sync_mock.mockReset()
	read_file_sync_mock.mockImplementation(actual_fs.readFileSync)
})

afterAll(() => {
	rmSync(SANDBOX, { recursive: true, force: true })
})

it.each(['EACCES', 'EPERM'])('writes when reading the destination fails with %s', (code) => {
	writeFileSync(DESTINATION, 'old content')
	read_file_sync_mock.mockImplementation(() => {
		throw Object.assign(new Error('read denied'), { code })
	})

	expect(file_content.write_text_if_changed(DESTINATION, NEW_CONTENT)).toBe(true)
	expect(actual_fs.readFileSync(DESTINATION, 'utf8')).toBe(NEW_CONTENT)
})

describe('file_content.write_contained', () => {
	it('refuses a symlink that points outside the project', () => {
		const target = path.join(OUTSIDE, 'zshrc')

		writeFileSync(target, 'original')
		symlinkSync(target, DESTINATION)

		expect(() => {
			file_content.write_contained(DESTINATION, NEW_CONTENT)
		}).toThrow(/outside the project/u)
		expect(actual_fs.readFileSync(target, 'utf8')).toBe('original')
	})

	it('refuses a dangling symlink whose target would be created outside the project', () => {
		const target = path.join(OUTSIDE, 'created')

		symlinkSync(target, DESTINATION)

		expect(() => {
			file_content.write_contained(DESTINATION, NEW_CONTENT)
		}).toThrow(/outside the project/u)
	})

	it('refuses a path under a symlinked directory that points outside the project', () => {
		const linked_directory = path.join(ROOT, 'linked')

		symlinkSync(OUTSIDE, linked_directory)

		expect(() => {
			file_content.write_contained(path.join(linked_directory, 'new.txt'), NEW_CONTENT)
		}).toThrow(/outside the project/u)
	})
})

describe('file_content.write_contained — a relative link behind a directory link', () => {
	// `back/up` links to the root, so the kernel reads `../outside/…` from the root, not from `back/up`.
	it('refuses a relative dangling symlink whose real parent puts it outside the project', () => {
		const target_name = 'created-relative'
		const link_name = 'relative.md'
		const back_directory = path.join(ROOT, 'back')

		mkdirSync(back_directory)
		symlinkSync(ROOT, path.join(back_directory, 'up'))
		symlinkSync(path.join('..', 'outside', target_name), path.join(ROOT, link_name))

		expect(() => {
			file_content.write_contained(path.join(back_directory, 'up', link_name), NEW_CONTENT)
		}).toThrow(/outside the project/u)
		expect(existsSync(path.join(OUTSIDE, target_name))).toBe(false)
	})
})

describe('file_content.write_contained — a directory link to outside', () => {
	it('creates no directory through it before refusing', () => {
		const link_directory = path.join(ROOT, 'linked-out')

		symlinkSync(OUTSIDE, link_directory)

		expect(() => {
			file_content.write_text_if_changed(path.join(link_directory, 'made', 'x.md'), NEW_CONTENT)
		}).toThrow(/outside the project/u)
		expect(existsSync(path.join(OUTSIDE, 'made'))).toBe(false)
	})
})

describe('file_content.write_contained — inside the project', () => {
	it('writes through a symlink that stays inside the project', () => {
		const target = path.join(ROOT, 'AGENTS.md')

		writeFileSync(target, 'original')
		symlinkSync('AGENTS.md', DESTINATION)
		file_content.write_contained(DESTINATION, NEW_CONTENT)

		expect(actual_fs.readFileSync(target, 'utf8')).toBe(NEW_CONTENT)
	})

	it('writes a new file in a directory that does not exist yet', () => {
		const destination = path.join(ROOT, 'nested', 'file.txt')

		expect(file_content.write_text_if_changed(destination, NEW_CONTENT)).toBe(true)

		expect(actual_fs.readFileSync(destination, 'utf8')).toBe(NEW_CONTENT)
	})
})
