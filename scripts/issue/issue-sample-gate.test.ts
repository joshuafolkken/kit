import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { issue_lint_cli } from './issue-lint-cli'
import { issue_not_before } from './issue-not-before'
import { issue_sample_gate, type PrimePorts } from './issue-sample-gate'

// joshuafolkken/kit#4414: a follow-up measurement waits on the merges the lane ledger records after the
// pull request it measures merged, not on a calendar time.

const PR = 4313
const MERGED_AT = '2026-10-20T18:00:00.000Z'
const BEFORE = '2026-10-20T17:00:00.000Z'
const AFTER = '2026-10-20T19:00:00.000Z'
const NEEDED = 2
const SOURCE_ISSUE = 4300

function body_with(line: string): string {
	return `## 背景\n\n- 種別: 非不具合\n- 規模見積もり: 約 1 ファイル / 10 行（テスト除く）\n${line}\n\n## 現象\n\n## 期待結果\n\n## 受け入れ条件\n`
}

const GATED_BODY = body_with(`- 実施可能条件: #${String(PR)} のマージ後 ${String(NEEDED)} マージ`)
const CITED_PULL = { cited: PR, via: 'pull' } as const
const CLOSING_BODY = body_with(
	`- 実施可能条件: #${String(SOURCE_ISSUE)} を閉じる PR のマージ後 ${String(NEEDED)} マージ`,
)

const state = { directory: '' }

function ledger_of(merges: ReadonlyArray<{ at: string; issue: number }>): string {
	const file = path.join(state.directory, 'ledger.jsonl')
	const lines = merges.map((merge) => JSON.stringify({ kind: 'merge', ...merge }))

	writeFileSync(file, `${lines.join('\n')}\n`, { mode: 0o600 })

	return file
}

function ledger_with(merge_times: ReadonlyArray<string>): string {
	return ledger_of(merge_times.map((at, index) => ({ at, issue: index + 1 })))
}

function ports_of(merged_at: string | undefined, ledger: string | undefined): PrimePorts {
	const read = { merged_at, closes: SOURCE_ISSUE }

	return {
		pull: vi.fn<PrimePorts['pull']>().mockResolvedValue(read),
		closing: vi.fn<PrimePorts['closing']>().mockResolvedValue(read),
		ledger_path: vi.fn<PrimePorts['ledger_path']>().mockResolvedValue(ledger),
	}
}

beforeEach(() => {
	state.directory = mkdtempSync(path.join(tmpdir(), 'sample-gate-'))
})

afterEach(() => {
	issue_sample_gate.reset()
	rmSync(state.directory, { recursive: true, force: true })
})

describe('issue_sample_gate.wait_of', () => {
	it('waits on a body nobody primed', () => {
		expect(issue_sample_gate.wait_of(GATED_BODY)).toStrictEqual({ kind: 'unread', ...CITED_PULL })
	})

	it('waits while the pull request has not merged', async () => {
		await issue_sample_gate.prime([GATED_BODY], ports_of(undefined, undefined))

		expect(issue_sample_gate.wait_of(GATED_BODY)).toStrictEqual({ kind: 'unmerged', ...CITED_PULL })
	})

	it('counts only the merges recorded after the pull request merged', async () => {
		const ledger = ledger_with([BEFORE, AFTER])

		await issue_sample_gate.prime([GATED_BODY], ports_of(MERGED_AT, ledger))

		expect(issue_sample_gate.wait_of(GATED_BODY)).toStrictEqual({
			kind: 'short',
			cited: PR,
			via: 'pull',
			counted: 1,
			needed: NEEDED,
		})
	})

	it('releases the body once the declared merges are recorded', async () => {
		const ledger = ledger_with([AFTER, AFTER])

		await issue_sample_gate.prime([GATED_BODY], ports_of(MERGED_AT, ledger))

		expect(issue_sample_gate.wait_of(GATED_BODY)).toBeUndefined()
	})
})

describe('issue_sample_gate.wait_of without a condition', () => {
	it('declares nothing for a body without the line', () => {
		expect(issue_sample_gate.wait_of(body_with(''))).toBeUndefined()
	})
})

describe("issue_sample_gate.wait_of on the pull request's own merge", () => {
	it('does not count it, though run:merge records it after the pull request merged', async () => {
		const ledger = ledger_of([
			{ at: AFTER, issue: SOURCE_ISSUE },
			{ at: AFTER, issue: 1 },
		])

		await issue_sample_gate.prime([GATED_BODY], ports_of(MERGED_AT, ledger))

		expect(issue_sample_gate.wait_of(GATED_BODY)).toStrictEqual({
			kind: 'short',
			cited: PR,
			via: 'pull',
			counted: 1,
			needed: NEEDED,
		})
	})
})

describe('issue_sample_gate.prime', () => {
	it('reads nothing for bodies that declare no condition', async () => {
		const ports = ports_of(MERGED_AT, undefined)

		await issue_sample_gate.prime([body_with(''), undefined], ports)

		expect(ports.pull).not.toHaveBeenCalled()
	})

	it('reads a merged pull request once, and an unmerged one again', async () => {
		const merged = ports_of(MERGED_AT, undefined)
		const unmerged = ports_of(undefined, undefined)

		await issue_sample_gate.prime([GATED_BODY, GATED_BODY], merged)
		await issue_sample_gate.prime([GATED_BODY], merged)
		issue_sample_gate.reset()
		await issue_sample_gate.prime([GATED_BODY], unmerged)
		await issue_sample_gate.prime([GATED_BODY], unmerged)

		expect(merged.pull).toHaveBeenCalledTimes(1)
		expect(unmerged.pull).toHaveBeenCalledTimes(2)
	})

	it('leaves a failed read unread', async () => {
		const ports = ports_of(MERGED_AT, undefined)

		vi.mocked(ports.pull).mockRejectedValue(new Error('rate limited'))
		await issue_sample_gate.prime([GATED_BODY], ports)

		expect(issue_sample_gate.wait_of(GATED_BODY)?.kind).toBe('unread')
	})
})

describe('issue_not_before with a sample condition', () => {
	it('holds the issue back and names the merges it still waits on', async () => {
		await issue_sample_gate.prime([GATED_BODY], ports_of(MERGED_AT, ledger_with([AFTER])))

		expect(issue_not_before.is_due(GATED_BODY)).toBe(false)
		expect(issue_not_before.waiting_reason(GATED_BODY)).toBe(`1/2 merges after #${String(PR)}`)
	})

	it('says the pull request it waits on before it merges or is read', async () => {
		expect(issue_not_before.waiting_reason(GATED_BODY)).toBe(
			`until the merge of #${String(PR)} is read`,
		)
		await issue_sample_gate.prime([GATED_BODY], ports_of(undefined, undefined))
		expect(issue_not_before.waiting_reason(GATED_BODY)).toBe(`until #${String(PR)} merges`)
	})

	it('is due once the samples are recorded', async () => {
		await issue_sample_gate.prime([GATED_BODY], ports_of(MERGED_AT, ledger_with([AFTER, AFTER])))

		expect(issue_not_before.is_due(GATED_BODY)).toBe(true)
	})
})

// joshuafolkken/kit#5051: a lane files its follow-up before its own pull request exists, citing the
// issue whose closing pull request the samples are counted after.
describe('issue_sample_gate with the issue form', () => {
	it('waits on the closing pull request until it merges', async () => {
		const ports = ports_of(undefined, undefined)

		await issue_sample_gate.prime([CLOSING_BODY], ports)

		expect(ports.closing).toHaveBeenCalledWith(SOURCE_ISSUE)
		expect(ports.pull).not.toHaveBeenCalled()
		expect(issue_not_before.waiting_reason(CLOSING_BODY)).toBe(
			`until the pull request closing #${String(SOURCE_ISSUE)} merges`,
		)
	})

	it('counts the merges after the closing pull request, not its own', async () => {
		const ledger = ledger_of([
			{ at: AFTER, issue: SOURCE_ISSUE },
			{ at: AFTER, issue: 1 },
		])

		await issue_sample_gate.prime([CLOSING_BODY], ports_of(MERGED_AT, ledger))

		expect(issue_sample_gate.wait_of(CLOSING_BODY)).toStrictEqual({
			kind: 'short',
			cited: SOURCE_ISSUE,
			via: 'issue',
			counted: 1,
			needed: NEEDED,
		})
	})

	it('reads the issue apart from a pull request of the same number', async () => {
		const pull_body = body_with(`- 実施可能条件: #${String(SOURCE_ISSUE)} のマージ後 1 マージ`)
		const ports = ports_of(MERGED_AT, undefined)

		await issue_sample_gate.prime([CLOSING_BODY, pull_body], ports)

		expect(ports.closing).toHaveBeenCalledTimes(1)
		expect(ports.pull).toHaveBeenCalledTimes(1)
	})
})

describe('issue_sample_gate.cited_via', () => {
	it('names the cited number by its form only', () => {
		expect(issue_sample_gate.cited_via(CLOSING_BODY, 'issue')).toBe(SOURCE_ISSUE)
		expect(issue_sample_gate.cited_via(CLOSING_BODY, 'pull')).toBeUndefined()
		expect(issue_sample_gate.cited_via(GATED_BODY, 'pull')).toBe(PR)
	})
})

describe('the sample declaration in issue:lint', () => {
	it.each([GATED_BODY, CLOSING_BODY])('accepts the declared shape', (body) => {
		expect(issue_lint_cli.problems(body)).toEqual([])
	})

	it.each(['#4313 のマージ後 0 マージ', '4313 のマージ後 3 マージ', '#4313 の 3 日後', ''])(
		'refuses %j',
		(value) => {
			const found = issue_lint_cli.problems(body_with(`- 実施可能条件: ${value}`))

			expect(found).toEqual([expect.stringContaining(issue_sample_gate.CLOSING_FORMAT)])
		},
	)
})
