import { describe, expect, it, vi } from 'vitest'
import { dependabot_pin_logic, type DependabotPinOps } from './dependabot-pin-logic'
import type { PinDrift } from './workflow-pin-logic'

const START_BRANCH = 'main'
const PR_BRANCH = 'dependabot/github_actions/actions/checkout-7.0.0'
const FIRST_PR = 578
const SECOND_PR = 641
const COMMIT_MESSAGE = 'Sync template workflow pins (Dependabot #578)'
const PUSH_FAILED = 'push failed'

function make_drift(): PinDrift {
	return {
		template: 'templates/workflows/ci.yml',
		line: 53,
		action: 'actions/checkout',
		from: 'old # v6.0.3',
		to: 'new # v7.0.0',
	}
}

function create_fake_ops(drifts: Array<PinDrift>): DependabotPinOps {
	return {
		get_current_branch: vi
			.fn<() => Promise<string>>()
			.mockResolvedValueOnce(START_BRANCH)
			.mockResolvedValue(PR_BRANCH),
		get_pr_branch: vi.fn<(pr: number) => Promise<string>>().mockResolvedValue(PR_BRANCH),
		checkout_pr: vi.fn<(pr: number) => Promise<void>>().mockResolvedValue(undefined),
		checkout_branch: vi.fn<(branch: string) => Promise<void>>().mockResolvedValue(undefined),
		sync_pins: vi.fn<() => Array<PinDrift>>().mockReturnValue(drifts),
		stage_templates: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
		commit: vi.fn<(message: string) => Promise<void>>().mockResolvedValue(undefined),
		push: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
		log: vi.fn<(message: string) => void>(),
	}
}

describe('dependabot_pin_logic.build_commit_message', () => {
	it('embeds the PR number in a Dependabot-tagged message', () => {
		expect(dependabot_pin_logic.build_commit_message(SECOND_PR)).toBe(
			'Sync template workflow pins (Dependabot #641)',
		)
	})
})

describe('dependabot_pin_logic.parse_pr_numbers', () => {
	it('parses a list of positive integers', () => {
		expect(dependabot_pin_logic.parse_pr_numbers(['578', '641'])).toEqual([FIRST_PR, SECOND_PR])
	})

	it('throws when no PR numbers are supplied', () => {
		expect(() => dependabot_pin_logic.parse_pr_numbers([])).toThrow(/No PR numbers/u)
	})

	it('throws on a non-integer or non-positive token', () => {
		expect(() => dependabot_pin_logic.parse_pr_numbers(['abc'])).toThrow(/Invalid PR number/u)
		expect(() => dependabot_pin_logic.parse_pr_numbers(['0'])).toThrow(/Invalid PR number/u)
	})

	it('rejects loose numeric forms that Number() would coerce', () => {
		for (const token of ['1e3', '0x24', '5.0', ' 578 ', '007', '-5']) {
			expect(() => dependabot_pin_logic.parse_pr_numbers([token])).toThrow(/Invalid PR number/u)
		}
	})
})

describe('dependabot_pin_logic.run_sync (apply)', () => {
	it('checks out, syncs, commits, pushes and restores the branch when pins drift', async () => {
		const ops = create_fake_ops([make_drift()])

		const results = await dependabot_pin_logic.run_sync([FIRST_PR], { is_dry_run: false }, ops)

		expect(ops.checkout_pr).toHaveBeenCalledWith(FIRST_PR)
		expect(ops.commit).toHaveBeenCalledWith(COMMIT_MESSAGE)
		expect(ops.push).toHaveBeenCalledTimes(1)
		expect(ops.checkout_branch).toHaveBeenCalledWith(START_BRANCH)
		expect(results).toEqual([{ pr: FIRST_PR, synced_count: 1, is_committed: true }])
	})

	it('stages before it commits and commits before it pushes', async () => {
		const ops = create_fake_ops([make_drift()])

		await dependabot_pin_logic.run_sync([FIRST_PR], { is_dry_run: false }, ops)

		const [staged = 0] = vi.mocked(ops.stage_templates).mock.invocationCallOrder
		const [committed = 0] = vi.mocked(ops.commit).mock.invocationCallOrder
		const [pushed = 0] = vi.mocked(ops.push).mock.invocationCallOrder

		expect(staged).toBeLessThan(committed)
		expect(committed).toBeLessThan(pushed)
	})

	it('skips commit and push when there is no drift', async () => {
		const ops = create_fake_ops([])

		const results = await dependabot_pin_logic.run_sync([FIRST_PR], { is_dry_run: false }, ops)

		expect(ops.stage_templates).not.toHaveBeenCalled()
		expect(ops.push).not.toHaveBeenCalled()
		expect(results).toEqual([{ pr: FIRST_PR, synced_count: 0, is_committed: false }])
	})

	it('processes multiple PRs in order', async () => {
		const ops = create_fake_ops([make_drift()])

		await dependabot_pin_logic.run_sync([FIRST_PR, SECOND_PR], { is_dry_run: false }, ops)

		expect(ops.checkout_pr).toHaveBeenNthCalledWith(1, FIRST_PR)
		expect(ops.checkout_pr).toHaveBeenNthCalledWith(2, SECOND_PR)
	})
})

describe('dependabot_pin_logic.run_sync (safety)', () => {
	it('does not sync or commit when the checked-out branch is not a Dependabot branch', async () => {
		const ops = create_fake_ops([make_drift()])

		vi.mocked(ops.get_current_branch)
			.mockReset()
			.mockResolvedValueOnce(START_BRANCH)
			.mockResolvedValue('feature/manual')

		const results = await dependabot_pin_logic.run_sync([FIRST_PR], { is_dry_run: false }, ops)

		expect(ops.sync_pins).not.toHaveBeenCalled()
		expect(ops.commit).not.toHaveBeenCalled()
		expect(results).toEqual([{ pr: FIRST_PR, synced_count: 0, is_committed: false }])
	})

	it('restores the starting branch even when a PR fails mid-run', async () => {
		const ops = create_fake_ops([make_drift()])

		vi.mocked(ops.push).mockRejectedValue(new Error(PUSH_FAILED))

		await expect(
			dependabot_pin_logic.run_sync([FIRST_PR], { is_dry_run: false }, ops),
		).rejects.toThrow(PUSH_FAILED)
		expect(ops.checkout_branch).toHaveBeenCalledWith(START_BRANCH)
	})
})

describe('dependabot_pin_logic.run_sync (dry-run)', () => {
	it('performs no checkout, commit or push and logs a plan line per PR', async () => {
		const ops = create_fake_ops([make_drift()])

		await dependabot_pin_logic.run_sync([FIRST_PR, SECOND_PR], { is_dry_run: true }, ops)

		expect(ops.checkout_pr).not.toHaveBeenCalled()
		expect(ops.stage_templates).not.toHaveBeenCalled()
		expect(ops.push).not.toHaveBeenCalled()
		expect(ops.checkout_branch).not.toHaveBeenCalled()
		expect(ops.get_pr_branch).toHaveBeenCalledTimes(2)
		expect(ops.log).toHaveBeenCalledWith(expect.stringContaining(PR_BRANCH))
	})
})
