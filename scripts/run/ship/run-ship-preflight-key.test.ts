import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PreflightKey } from './run-ship-preflight-reuse'

const make_directory = temporary_directory('suite')

const reuse_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/git/git-branch', () => ({
	git_branch: { current: vi.fn().mockResolvedValue('6986-lane') },
}))
vi.mock('./run-ship-preflight-reuse', () => ({ run_ship_preflight_reuse: { run: reuse_mock } }))

const { run_ship_preflight } = await import('./run-ship-preflight')

// joshuafolkken/kit#6986: the preflight reuse is keyed by the branch's issue, the title and the body
// this ship delivers, and an unreadable body passes no key, so that preflight is asked every time.

const TITLE = 'Cut repeated ship preflight #6986'
const BODY = '## Summary\n\nthe body\n'
const TEMPORARY = make_directory('josh-ship-preflight-key-')

function body_file(text: string): string {
	const target = path.join(TEMPORARY, `${randomUUID()}.md`)

	writeFileSync(target, text)

	return target
}

beforeEach(() => {
	reuse_mock.mockReset().mockResolvedValue({ code: 0, out: 'ready' })
})

describe('run_ship_preflight.stage — the reuse key', () => {
	it('keys the reuse by the issue, the title and the body', async () => {
		await run_ship_preflight.stage({ title: TITLE, body_path: body_file(BODY) })

		const expected: PreflightKey = { issue: '6986', inputs: `${TITLE}\n${BODY}` }

		expect(reuse_mock).toHaveBeenCalledWith(expected, expect.any(Function))
	})

	it('passes no key when the body cannot be read', async () => {
		await run_ship_preflight.stage({ title: TITLE, body_path: path.join(TEMPORARY, 'missing.md') })

		expect(reuse_mock).toHaveBeenCalledWith(undefined, expect.any(Function))
	})
})
