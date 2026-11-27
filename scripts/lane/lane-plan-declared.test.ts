import path from 'node:path'
import type { OpenIssueData } from '#scripts/git/git-schemas'
import { temporary_directory } from '#tools/test/temporary-directory'
import { describe, expect, it } from 'vitest'
import { lane_ledger } from './lane-ledger'
import { lane_plan_declared } from './lane-plan-declared'

// joshuafolkken/kit#8954: `lane:plan` puts the size an Issue declares on the ledger as its lane starts,
// and writes nothing for an Issue declaring none or a listing it could not read.

const make_directory = temporary_directory('suite')
const scratch = make_directory('lane-plan-declared-test-')
const ISSUE = 8954
const AT = '2026-11-27T00:00:00.000Z'
const DECLARED_BODY = '## 背景\n\n- 規模見積もり: 約 12 ファイル / 310 行（テスト含む）\n'

function ledger(name: string): string {
	return path.join(scratch, `${name}.jsonl`)
}

function issue_with(body: string): Array<OpenIssueData> {
	return [{ number: ISSUE, title: 'lane', createdAt: AT, labels: [], body }]
}

describe('lane_plan_declared.record', () => {
	it('writes the declared files and lines of the planned issue', async () => {
		const target = ledger('declared')

		await lane_plan_declared.record(ISSUE, issue_with(DECLARED_BODY), target)

		expect(lane_ledger.read_entries(target)).toMatchObject([
			{ kind: 'declared', issue: ISSUE, files: 12, lines: 310 },
		])
	})

	it('writes nothing for an issue declaring no size', async () => {
		const target = ledger('undeclared')

		await lane_plan_declared.record(ISSUE, issue_with('## 背景\n'), target)

		expect(lane_ledger.read_entries(target)).toEqual([])
	})

	it('writes nothing where the listing was not read', async () => {
		const target = ledger('unread')

		await lane_plan_declared.record(ISSUE, undefined, target)

		expect(lane_ledger.read_entries(target)).toEqual([])
	})
})
