import { git_branch } from '#scripts/git/git-branch'
import { run_ship_preflight } from '#scripts/run/ship/run-ship-preflight'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { acceptance_check_cli } from './acceptance-check-cli'
import { acceptance_map_check } from './acceptance-map-check'

// joshuafolkken/kit#7727: ship's acceptance-map refusal asked of the draft before the review.

const BRANCH = '7727-lane'
const ISSUE = '7727'
const DRAFT = '## 受け入れ条件の対応\n\n- `ac-11111111` row — 未記入'
const REFUSAL = 'Criteria with no row:\n  - `ac-22222222` missing'
const REFUSED_EXIT = 1
const USAGE_EXIT = 2

beforeEach(() => {
	vi.spyOn(git_branch, 'current').mockResolvedValue(BRANCH)
	vi.spyOn(run_ship_preflight, 'body_text').mockResolvedValue(DRAFT)
	vi.spyOn(console, 'info').mockReturnValue()
	vi.spyOn(console, 'error').mockReturnValue()
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('acceptance_check_cli.run', () => {
	it("asks ship's judgment, acceptance_map_check.body_refusal, of the draft with pending rows present (ac-1efa530c)", async () => {
		const refusal = vi.spyOn(acceptance_map_check, 'body_refusal').mockResolvedValue(undefined)

		await expect(acceptance_check_cli.run([])).resolves.toBe(0)

		expect(run_ship_preflight.body_text).toHaveBeenCalledWith(undefined)
		expect(refusal).toHaveBeenCalledWith(ISSUE, DRAFT, { pending_present: true })
		expect(console.info).toHaveBeenCalledWith(acceptance_check_cli.PASS)
	})

	it('exits 1 with the refusal naming the criterion with no row', async () => {
		vi.spyOn(acceptance_map_check, 'body_refusal').mockResolvedValue(REFUSAL)

		await expect(acceptance_check_cli.run([])).resolves.toBe(REFUSED_EXIT)

		expect(console.error).toHaveBeenCalledWith(REFUSAL)
	})

	it('passes with no body yet, which ship writes in full', async () => {
		vi.mocked(run_ship_preflight.body_text).mockResolvedValue(undefined)
		const refusal = vi.spyOn(acceptance_map_check, 'body_refusal')

		await expect(acceptance_check_cli.run([])).resolves.toBe(0)

		expect(refusal).not.toHaveBeenCalled()
	})

	it('passes a branch with no issue number without asking', async () => {
		vi.mocked(git_branch.current).mockResolvedValue('main')
		const refusal = vi.spyOn(acceptance_map_check, 'body_refusal')

		await expect(acceptance_check_cli.run([])).resolves.toBe(0)

		expect(refusal).not.toHaveBeenCalled()
	})

	it('refuses an argument with the usage line', async () => {
		await expect(acceptance_check_cli.run(['7727'])).resolves.toBe(USAGE_EXIT)

		expect(console.error).toHaveBeenCalledWith(acceptance_check_cli.USAGE)
	})
})
