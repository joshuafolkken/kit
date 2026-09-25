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
import { afterEach, describe, expect, it, vi } from 'vitest'
import { sync } from './sync'

const ROOT = mkdtempSync(path.join(tmpdir(), 'sync-write-'))
const SOURCE = path.join(ROOT, 'source')
const DESTINATION = path.join(ROOT, 'consumer', 'file.md')
const OLD_DATE = new Date('2020-01-01T00:00:00Z')
const REVIEW_REFERENCE = 'see `prompts/review.md`\n'

afterEach(() => {
	rmSync(path.join(ROOT, 'consumer'), { recursive: true, force: true })
	rmSync(SOURCE, { force: true })
	vi.restoreAllMocks()
})

describe('sync file writes', () => {
	it('preserves the timestamp and reports unchanged after a repeated mapped sync', () => {
		writeFileSync(SOURCE, 'plain content\n')
		sync.sync_file_mapping(SOURCE, DESTINATION)
		utimesSync(DESTINATION, OLD_DATE, OLD_DATE)
		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		sync.sync_file_mapping(SOURCE, DESTINATION)

		expect(statSync(DESTINATION).mtimeMs).toBe(OLD_DATE.getTime())
		expect(info).toHaveBeenCalledWith(expect.stringContaining('unchanged'))
	})

	it('updates a changed mapped file and preserves its transformed reference', () => {
		writeFileSync(SOURCE, 'old\n')
		sync.sync_file_mapping(SOURCE, DESTINATION)
		writeFileSync(SOURCE, REVIEW_REFERENCE)

		sync.sync_file_mapping(SOURCE, DESTINATION)

		expect(readFileSync(DESTINATION, 'utf8')).toContain(
			'node_modules/@joshuafolkken/kit/prompts/review.md',
		)
	})

	it('does not rewrite a workspace file whose merged content is unchanged', () => {
		const workspace = path.join(ROOT, 'consumer', 'pnpm-workspace.yaml')

		writeFileSync(SOURCE, 'packages:\n  - app\n')
		mkdirSync(path.dirname(workspace), { recursive: true })
		sync.sync_workspace_yaml(SOURCE, workspace)
		utimesSync(workspace, OLD_DATE, OLD_DATE)

		expect(sync.sync_workspace_yaml(SOURCE, workspace)).toBe(false)
		expect(statSync(workspace).mtimeMs).toBe(OLD_DATE.getTime())
	})
})

describe('transformed workflow write', () => {
	it('does not rewrite a transformed workflow on the second sync', () => {
		const workflow = path.join(ROOT, 'consumer', '.github', 'workflows', 'ci.yml')

		writeFileSync(SOURCE, REVIEW_REFERENCE)
		sync.sync_file_mapping(SOURCE, workflow)
		utimesSync(workflow, OLD_DATE, OLD_DATE)

		sync.sync_file_mapping(SOURCE, workflow)

		expect(statSync(workflow).mtimeMs).toBe(OLD_DATE.getTime())
	})
})
