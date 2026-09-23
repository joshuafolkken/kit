import { describe, expect, it, vi } from 'vitest'
import type { RedRun } from './test-red'
import { test_red_commit, type RedCommitPorts } from './test-red-commit'

const ISSUE = '2393'
const BUG_BODY = '## 背景\n\n- 種別: 不具合\n'
const FILES = ['scripts/run/run-report.test.ts']

function ports_of(body: string | undefined, run: RedRun): RedCommitPorts {
	return {
		read_body: vi.fn(async function read_body(): Promise<string | undefined> {
			return body
		}),
		run: vi.fn(async function run_tests(): Promise<RedRun> {
			return run
		}),
	}
}

describe('test_red_commit.assert_reproduces', () => {
	it('refuses a declared bug fix whose tests are green on the pre-fix tree', async () => {
		const ports = ports_of(BUG_BODY, { verdict: 'green', files: FILES })

		await expect(test_red_commit.assert_reproduces(ISSUE, ports)).rejects.toThrow(
			/declares `- 種別: 不具合`[\s\S]*run-report\.test\.ts/u,
		)
	})

	it('lets a declared bug fix through when a test is red or none changed', async () => {
		await expect(
			test_red_commit.assert_reproduces(
				ISSUE,
				ports_of(BUG_BODY, { verdict: 'red', files: FILES }),
			),
		).resolves.toBeUndefined()
		await expect(
			test_red_commit.assert_reproduces(
				ISSUE,
				ports_of(BUG_BODY, { verdict: 'no-test', files: [] }),
			),
		).resolves.toBeUndefined()
	})

	it('never runs the tests for an Issue that is not a declared bug fix', async () => {
		const ports = ports_of('## 背景\n\n- 種別: 振る舞い変更\n', { verdict: 'green', files: FILES })

		await expect(test_red_commit.assert_reproduces(ISSUE, ports)).resolves.toBeUndefined()
		await expect(
			test_red_commit.assert_reproduces(
				ISSUE,
				ports_of(undefined, { verdict: 'green', files: FILES }),
			),
		).resolves.toBeUndefined()
		expect(ports.run).not.toHaveBeenCalled()
	})
})
