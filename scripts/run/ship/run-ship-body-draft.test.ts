import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { acceptance_map } from '#scripts/review/acceptance-map'
import { live_evidence } from '#scripts/review/live-evidence'
import { removed_tests } from '#scripts/review/removed-tests'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ShipArguments } from './run-ship-steps'

const directories_mock = vi.hoisted(() => vi.fn<() => Promise<Array<string>>>())

vi.mock('#scripts/git/git-command', () => ({
	git_command: { git_directories: directories_mock },
}))

const { run_ship_body_draft } = await import('./run-ship-body-draft')

// joshuafolkken/kit#4168: the acceptance rows a ship refused on land in a file the ship reads when
// `--body-file` is omitted, so the run fills them in before the ship rather than after its stop.

const ISSUE = '4168'
const ROWS = '## 受け入れ条件の対応\n\n- `ac-12345678` the criterion — 未記入'
const FILLED = '## 受け入れ条件の対応\n\n- `ac-12345678` the criterion — 満たした: test\n'
const TEMPORARY = mkdtempSync(path.join(tmpdir(), 'josh-ship-body-draft-'))
const OWN_BODY = path.join(TEMPORARY, 'own-body.md')
const GIT_DIRECTORY = path.join(TEMPORARY, 'git')
const BODY_FLAG = '--body-file'
const RUNTIME_PATH = 'scripts/run/ship/run-ship-body-draft.ts'
const ARGS: ShipArguments = {
	title: 'Satisfy the preconditions #4168',
	number: ISSUE,
	notify: [],
	body: [],
	body_path: undefined,
	cites: [],
	is_review: false,
	is_detach: false,
	unpinned_ok: [],
}

mkdirSync(GIT_DIRECTORY)

beforeEach(() => {
	rmSync(path.join(GIT_DIRECTORY, `josh-ship-body-${ISSUE}.md`), { force: true })
	directories_mock.mockReset().mockResolvedValue([GIT_DIRECTORY, TEMPORARY])
})

afterAll(() => {
	rmSync(TEMPORARY, { recursive: true, force: true })
})

describe('run_ship_body_draft.prepare — the draft in the work tree git directory', () => {
	it('writes the rows and an evidence heading under the work tree git directory', async () => {
		const draft = await run_ship_body_draft.prepare(ISSUE, ROWS)
		const text = readFileSync(draft, 'utf8')

		expect(path.dirname(draft)).toBe(GIT_DIRECTORY)
		expect(text.startsWith(`${ROWS}\n\n`)).toBe(true)
		expect(text.endsWith(`\n\n${live_evidence.EVIDENCE_HEADING}\n`)).toBe(true)
	})

	it('keeps a draft the run already filled in', async () => {
		const draft = await run_ship_body_draft.path_of(ISSUE)

		writeFileSync(draft, FILLED)

		expect(await run_ship_body_draft.prepare(ISSUE, ROWS)).toBe(draft)
		expect(readFileSync(draft, 'utf8')).toBe(FILLED)
	})

	it('refuses when git names no directory', async () => {
		directories_mock.mockResolvedValue([])

		await expect(run_ship_body_draft.prepare(ISSUE, ROWS)).rejects.toThrow('no git directory')
	})
})

// joshuafolkken/kit#4478: lanes met each format only at the refusal and shipped into it twice.
describe('run_ship_body_draft.prepare — the formats the preflight asks for', () => {
	it.each([
		['the acceptance rows', acceptance_map.ROW_FORMAT],
		['the live evidence', live_evidence.EVIDENCE_FORMAT],
		['the removed tests', removed_tests.ROW_FORMAT],
	])('names the format of %s in a comment', async (_label, format) => {
		const text = readFileSync(await run_ship_body_draft.prepare(ISSUE, ROWS), 'utf8')
		const lines = text.split('\n')

		expect(lines.some((line) => line.startsWith('<!--') && line.includes(format))).toBe(true)
	})

	it('meets no acceptance row and no live evidence by its comments alone', async () => {
		const text = readFileSync(await run_ship_body_draft.prepare(ISSUE, ROWS), 'utf8')
		const output_only = `${text}\n\`\`\`text\nok\n\`\`\`\n`

		expect(acceptance_map.rows_of(text).met.size).toBe(0)
		expect(live_evidence.verdict_for([RUNTIME_PATH], output_only)).toBe('required')
	})
})

describe('run_ship_body_draft.remove — the draft goes once the pull request merged', () => {
	it('removes the draft so a reopened issue never ships the old body', async () => {
		await run_ship_body_draft.prepare(ISSUE, ROWS)
		await run_ship_body_draft.remove(ISSUE)

		expect(await run_ship_body_draft.existing(ISSUE)).toBeUndefined()
	})

	it('succeeds when no draft exists', async () => {
		await expect(run_ship_body_draft.remove(ISSUE)).resolves.toBeUndefined()
	})
})

describe('run_ship_body_draft.with_draft — the body josh ship delivers', () => {
	it('hands the draft as --body-file when it was omitted', async () => {
		const draft = await run_ship_body_draft.prepare(ISSUE, ROWS)

		expect(await run_ship_body_draft.with_draft(ARGS)).toStrictEqual({
			...ARGS,
			body: [BODY_FLAG, draft],
			body_path: draft,
		})
	})

	it('keeps an explicit --body-file over the draft', async () => {
		await run_ship_body_draft.prepare(ISSUE, ROWS)
		const own = { ...ARGS, body: [BODY_FLAG, OWN_BODY], body_path: OWN_BODY }

		expect(await run_ship_body_draft.with_draft(own)).toBe(own)
	})

	it('leaves the arguments alone when no draft exists', async () => {
		expect(await run_ship_body_draft.existing(ISSUE)).toBeUndefined()
		expect(await run_ship_body_draft.with_draft(ARGS)).toBe(ARGS)
	})
})
