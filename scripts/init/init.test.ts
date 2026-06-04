import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { init } from './init'

const TEST_DIR = path.join(tmpdir(), 'init-test')
const TEMPLATE_PATH = path.join(TEST_DIR, 'template.properties')
const DEST_PATH = path.join(TEST_DIR, 'sonar-project.properties')

beforeEach(() => {
	mkdirSync(TEST_DIR, { recursive: true })
})

afterEach(() => {
	rmSync(TEST_DIR, { recursive: true, force: true })
})

const AI_COPY_SOURCE = readFileSync(
	fileURLToPath(new URL('init-ai-copy.ts', import.meta.url)),
	'utf8',
)

describe('skip messages', () => {
	it('reference josh sync not pnpm sync', () => {
		expect(AI_COPY_SOURCE).not.toContain('pnpm sync')
	})

	it('contain josh sync in file skip message', () => {
		expect(AI_COPY_SOURCE).toContain('run josh sync to update')
	})

	it('contain josh sync in summary tip message', () => {
		expect(AI_COPY_SOURCE).toContain('Run `josh sync`')
	})
})

const NO_REFERENCES_CONTENT = 'no references here\n'

describe('copy_ai_file', () => {
	it('writes file content to destination', () => {
		writeFileSync(TEMPLATE_PATH, NO_REFERENCES_CONTENT)
		init.copy_ai_file(TEMPLATE_PATH, DEST_PATH)

		expect(readFileSync(DEST_PATH, 'utf8')).toBe(NO_REFERENCES_CONTENT)
	})

	it('transforms prompts/ references to node_modules package path', () => {
		writeFileSync(TEMPLATE_PATH, 'see `prompts/refactoring.md`\n')
		init.copy_ai_file(TEMPLATE_PATH, DEST_PATH)

		expect(readFileSync(DEST_PATH, 'utf8')).toBe(
			'see `node_modules/@joshuafolkken/kit/prompts/refactoring.md`\n',
		)
	})

	it('creates destination directory when it does not exist', () => {
		const nested_destination = path.join(TEST_DIR, 'nested', 'dir', 'CLAUDE.md')

		writeFileSync(TEMPLATE_PATH, 'content\n')
		init.copy_ai_file(TEMPLATE_PATH, nested_destination)

		expect(existsSync(nested_destination)).toBe(true)
	})
})
