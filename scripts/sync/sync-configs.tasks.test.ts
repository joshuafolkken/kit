import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { parse_jsonc } from '#scripts/config-merge/parse-jsonc'
import { PACKAGE_DIR } from '#scripts/init/init-paths'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sync_configs } from './sync-configs'

const VSCODE_DIRECTORY = '.vscode'
const TASKS_FILENAME = 'tasks.json'
const KIT_TASKS_PATH = path.join(PACKAGE_DIR, VSCODE_DIRECTORY, TASKS_FILENAME)
const BOARD_COMMAND = 'pnpm josh run:board'

const ctx = { work_directory: '', destination: '' }

beforeEach(() => {
	ctx.work_directory = mkdtempSync(path.join(tmpdir(), 'sync-configs-tasks-'))
	ctx.destination = path.join(ctx.work_directory, VSCODE_DIRECTORY, TASKS_FILENAME)
	vi.spyOn(console, 'info').mockImplementation(() => {
		/* suppress */
	})
})

afterEach(() => {
	rmSync(ctx.work_directory, { recursive: true, force: true })
	vi.restoreAllMocks()
})

describe('sync_configs.sync_vscode_tasks_json', () => {
	it('creates the file, and the .vscode directory, from the kit tasks when absent', () => {
		sync_configs.sync_vscode_tasks_json(ctx.destination)

		expect(readFileSync(ctx.destination, 'utf8')).toBe(readFileSync(KIT_TASKS_PATH, 'utf8'))
	})

	it('merges the kit board task into an existing file, keeping the consumer task', () => {
		sync_configs.sync_vscode_tasks_json(ctx.destination)
		const own = { label: 'dev server', type: 'shell', command: 'pnpm dev' }

		writeFileSync(ctx.destination, JSON.stringify({ version: '2.0.0', tasks: [own] }))
		sync_configs.sync_vscode_tasks_json(ctx.destination)

		const result = readFileSync(ctx.destination, 'utf8')

		expect(result).toContain(BOARD_COMMAND)
		expect(parse_jsonc(result)['tasks']).toContainEqual(own)
	})
})
