import { git_gh_command } from '#scripts/git/git-gh-command'
import { DEPTH_0_LABEL, DEPTH_1_LABEL, EPIC_LABEL } from '#scripts/git/issue-labels'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { issue_depth_fixture } from './issue-depth-fixture'
import { issue_depth_share_cli } from './issue-depth-share-cli'

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const { depth_listing } = issue_depth_fixture

function stub_listing(json: string | undefined, is_capped = false): void {
	vi.spyOn(git_gh_command, 'issue_list_recent').mockResolvedValue({ json, is_capped })
}

function capture(): { out: Array<string>; errors: Array<string> } {
	const out: Array<string> = []
	const errors: Array<string> = []

	vi.spyOn(console, 'info').mockImplementation((line: string) => {
		out.push(line)
	})
	vi.spyOn(console, 'error').mockImplementation((line: string) => {
		errors.push(line)
	})

	return { out, errors }
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe('issue_depth_share_cli.run — what it reports', () => {
	it('prints the headline on stdout and the breakdown on stderr', async () => {
		stub_listing(depth_listing([EPIC_LABEL], [DEPTH_0_LABEL], [DEPTH_1_LABEL]))
		const { out, errors } = capture()

		expect(await issue_depth_share_cli.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(out).toStrictEqual(['1/2 = 50%'])
		expect(errors[0]).toContain('epics excluded 1')
	})

	it('says nothing about a partial read when the whole backlog was seen', async () => {
		stub_listing(depth_listing([DEPTH_0_LABEL]))
		const { errors } = capture()

		await issue_depth_share_cli.run([])

		expect(errors[0]).not.toContain(issue_depth_share_cli.PARTIAL_NOTE)
	})

	it('emits every figure plus the headline as one JSON object under --json', async () => {
		stub_listing(depth_listing([DEPTH_0_LABEL], []))
		const { out } = capture()

		await issue_depth_share_cli.run(['--json'])

		expect(JSON.parse(out[0] ?? '')).toStrictEqual({
			share: '1/2 = 50%',
			denominator: 2,
			depth_0: 1,
			depth_1: 0,
			depth_2: 0,
			unlabelled: 1,
			epics_excluded: 0,
			share_percent: 50,
			cutoff: 'none',
		})
	})
})

// The boundary the flag alone cannot see: five full pages select exactly the limit's worth of rows,
// so the listing's own `is_capped` is false while the page ceiling is what stopped it.
function full_listing(): string {
	return depth_listing(...Array.from({ length: issue_depth_share_cli.LISTING_LIMIT }, () => []))
}

describe('issue_depth_share_cli.run — a listing that stopped short', () => {
	it('reports a partial read when the listing filled the whole limit', async () => {
		stub_listing(full_listing())
		const { errors } = capture()

		await issue_depth_share_cli.run([])

		expect(errors[0]).toContain(issue_depth_share_cli.PARTIAL_NOTE)
	})

	it('names the row limit as the cutoff under --json', async () => {
		stub_listing(full_listing())
		const { out } = capture()

		await issue_depth_share_cli.run(['--json'])

		expect(JSON.parse(out[0] ?? '')).toMatchObject({ cutoff: 'row_limit' })
	})
})

describe('issue_depth_share_cli.run — what it refuses to invent', () => {
	it('answers unknown rather than a share when the listing could not be read', async () => {
		stub_listing(undefined)
		const { out, errors } = capture()

		expect(await issue_depth_share_cli.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(out).toStrictEqual([issue_depth_share_cli.UNKNOWN_ANSWER])
		expect(errors).toStrictEqual([issue_depth_share_cli.UNKNOWN_REASON])
	})

	it('carries the same answer key under --json, so the two shapes are told apart', async () => {
		stub_listing(undefined)
		const { out } = capture()

		await issue_depth_share_cli.run(['--json'])

		expect(JSON.parse(out[0] ?? '')).toStrictEqual({
			share: issue_depth_share_cli.UNKNOWN_ANSWER,
			reason: issue_depth_share_cli.UNKNOWN_REASON,
		})
	})

	it('answers unknown when the listing is not a listing at all', async () => {
		stub_listing('{"not":"an array"}')
		const { out, errors } = capture()

		await issue_depth_share_cli.run([])

		expect(out).toStrictEqual([issue_depth_share_cli.UNKNOWN_ANSWER])
		expect(errors).toStrictEqual([issue_depth_share_cli.UNKNOWN_REASON])
	})

	// A schema rejection sends a reader somewhere else than a failed fetch does, so it says so.
	it('names a changed listing shape separately from an unreadable one', async () => {
		stub_listing('[{"number":"not a number"}]')
		const { out, errors } = capture()

		await issue_depth_share_cli.run([])

		expect(out).toStrictEqual([issue_depth_share_cli.UNKNOWN_ANSWER])
		expect(errors).toStrictEqual([issue_depth_share_cli.SHAPE_REASON])
	})
})

describe('issue_depth_share_cli.run — the flags and the repeat', () => {
	it('refuses an unknown flag with the usage line', async () => {
		const { errors } = capture()

		expect(await issue_depth_share_cli.run(['--staged'])).toBe(FAILURE_EXIT_CODE)
		expect(errors).toStrictEqual([issue_depth_share_cli.USAGE])
	})

	it('answers identically when the same listing is measured twice', async () => {
		stub_listing(depth_listing([DEPTH_0_LABEL], [DEPTH_1_LABEL], []))
		const { out } = capture()

		await issue_depth_share_cli.run(['--json'])
		await issue_depth_share_cli.run(['--json'])

		expect(out[0]).toBe(out[1])
	})
})
