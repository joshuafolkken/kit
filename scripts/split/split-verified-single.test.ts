import { mkdtempSync } from 'node:fs'
import { rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { gate_tree } from '#scripts/gate/gate-tree'
import { scoped_green } from '#scripts/gate/scoped-green'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { acceptance_map } from '#scripts/review/acceptance-map'
import { run_ship_body_draft } from '#scripts/run/ship/run-ship-body-draft'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { split_verified_single } from './split-verified-single'

// joshuafolkken/kit#6572: one verified deliverable answers a size-only split notice; anything short of
// positive evidence keeps it.

const ISSUE = 6558
const DONE = 'The rate-limit offer is measured'
const REST = 'An independent deliverable still to build'
const DROPPED = 'A criterion the Issue no longer carries'
const GREEN = [scoped_green.LINT_SCRIPT, scoped_green.TEST_SCRIPT]

const read_gate_tree = vi.spyOn(gate_tree, 'read_gate_tree')
const green_scripts = vi.spyOn(scoped_green, 'green_scripts')
const issue_body = vi.spyOn(git_gh_command, 'issue_get_body_classified')
const draft_path = vi.spyOn(run_ship_body_draft, 'existing')

function body(...criteria: ReadonlyArray<string>): string {
	return ['## 受け入れ条件', ...criteria.map((text) => `- [x] ${text}`)].join('\n')
}

function row(text: string, ending: string): string {
	return `- \`${acceptance_map.criterion_id(text)}\` ${text} — ${ending}`
}

function draft(...rows: ReadonlyArray<string>): string {
	return [acceptance_map.MAP_HEADING, '', ...rows].join('\n')
}

const MET = '満たした: split-verified-single.test.ts'
const MET_DRAFT = draft(row(DONE, MET))
const DONE_BODY = body(DONE)

const DRAFT_DIRECTORY = mkdtempSync(path.join(tmpdir(), 'split-verified-'))

async function draft_file(text: string): Promise<string> {
	const target = path.join(DRAFT_DIRECTORY, 'draft.md')

	await writeFile(target, text)

	return target
}

afterAll(async () => {
	await rm(DRAFT_DIRECTORY, { recursive: true, force: true })
})

beforeEach(async () => {
	read_gate_tree.mockResolvedValue({ files: { 'a.ts': 'hash' }, base: 'base' })
	green_scripts.mockReturnValue(GREEN)
	issue_body.mockResolvedValue({ kind: 'read', text: DONE_BODY })
	draft_path.mockResolvedValue(await draft_file(MET_DRAFT))
})

describe('split_verified_single.all_met', () => {
	it('accepts every current criterion met (ac-8e54309c)', () => {
		expect(split_verified_single.all_met(DONE_BODY, MET_DRAFT)).toBe(true)
	})

	it('refuses an unfinished criterion left pending (ac-30747931)', () => {
		const rows = draft(row(DONE, MET), row(REST, '未記入'))

		expect(split_verified_single.all_met(body(DONE, REST), rows)).toBe(false)
	})

	it('refuses a deferred criterion (ac-30747931)', () => {
		const rows = draft(row(DONE, MET), row(REST, '見送り: #6600 independent rest'))

		expect(split_verified_single.all_met(body(DONE, REST), rows)).toBe(false)
	})

	it('refuses a stale row for a criterion the Issue dropped', () => {
		const rows = draft(row(DONE, MET), row(DROPPED, MET))

		expect(split_verified_single.all_met(body(DONE), rows)).toBe(false)
	})

	it('refuses a criterion whose only met row is a fenced example (ac-9bf51e20)', () => {
		const fenced = draft('~~~md', row(REST, '満たした: example only'), '~~~')

		expect(split_verified_single.all_met(body(REST), fenced)).toBe(false)
	})

	it('refuses an Issue with no acceptance criteria', () => {
		expect(split_verified_single.all_met('no criteria', draft())).toBe(false)
	})
})

describe('split_verified_single.verified', () => {
	it('answers on met rows and green scoped checks for this tree (ac-8e54309c)', async () => {
		expect(await split_verified_single.verified(ISSUE)).toBe(true)
	})

	it('reads the pair against the whole tree, josh run records included', async () => {
		const files = { 'a.ts': 'hash', '.josh/metrics-accepted/6558.json': 'record' }

		read_gate_tree.mockResolvedValueOnce({ files, base: 'base' })

		expect(await split_verified_single.verified(ISSUE)).toBe(true)
		expect(green_scripts).toHaveBeenCalledWith(files, 'base')
	})

	it('refuses when test:related is not green on this tree', async () => {
		green_scripts.mockReturnValueOnce([scoped_green.LINT_SCRIPT])

		expect(await split_verified_single.verified(ISSUE)).toBe(false)
	})

	it('refuses an Issue that cannot be read', async () => {
		issue_body.mockResolvedValueOnce({ kind: 'missing' })

		expect(await split_verified_single.verified(ISSUE)).toBe(false)
	})

	it('refuses without a ship draft', async () => {
		draft_path.mockResolvedValueOnce(undefined)

		expect(await split_verified_single.verified(ISSUE)).toBe(false)
	})

	it('refuses when the tree cannot be read', async () => {
		read_gate_tree.mockRejectedValueOnce(new Error('git failed'))

		expect(await split_verified_single.verified(ISSUE)).toBe(false)
	})
})
