import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { parse_jsonc } from '#scripts/config-merge/parse-jsonc'
import { PACKAGE_DIR } from '#scripts/init/init-paths'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sync_configs } from './sync-configs'

const VSCODE_DIRECTORY = '.vscode'
const TASKS_FILENAME = 'tasks.json'
const KIT_TASKS_PATH = path.join(PACKAGE_DIR, VSCODE_DIRECTORY, TASKS_FILENAME)
const BOARD_LABEL = 'josh: run board'
const BOARD_COMMAND = 'pnpm josh run:board'
const FOLDER_OPEN = 'folderOpen'

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

function write_destination(content: Record<string, unknown>): void {
	mkdirSync(path.dirname(ctx.destination), { recursive: true })
	writeFileSync(ctx.destination, JSON.stringify(content))
}

describe('sync_configs.sync_vscode_tasks_json', () => {
	it('leaves an absent file absent', () => {
		sync_configs.sync_vscode_tasks_json(ctx.destination)

		expect(existsSync(ctx.destination)).toBe(false)
	})

	it('merges the kit board task into an existing file, keeping the consumer task', () => {
		const own = { label: 'dev server', type: 'shell', command: 'pnpm dev' }

		write_destination({ version: '2.0.0', tasks: [own] })
		sync_configs.sync_vscode_tasks_json(ctx.destination)

		const result = readFileSync(ctx.destination, 'utf8')

		expect(result).toContain(BOARD_COMMAND)
		expect(parse_jsonc(result)['tasks']).toContainEqual(own)
	})
})

// joshuafolkken/kit#4536: the board starts only when a person runs it.
describe('sync_configs.sync_vscode_tasks_json — the folder-open board task', () => {
	it('ships no task that runs on folder open', () => {
		expect(readFileSync(KIT_TASKS_PATH, 'utf8')).not.toContain(FOLDER_OPEN)
	})

	it('replaces a consumer board task that runs on folder open with one that does not', () => {
		const folder_open_board = {
			label: BOARD_LABEL,
			type: 'shell',
			command: BOARD_COMMAND,
			runOptions: { runOn: FOLDER_OPEN },
		}

		write_destination({ version: '2.0.0', tasks: [folder_open_board] })
		sync_configs.sync_vscode_tasks_json(ctx.destination)

		expect(parse_jsonc(readFileSync(ctx.destination, 'utf8'))['tasks']).toStrictEqual(
			parse_jsonc(readFileSync(KIT_TASKS_PATH, 'utf8'))['tasks'],
		)
	})
})
