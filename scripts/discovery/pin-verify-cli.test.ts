import { beforeEach, describe, expect, it, vi } from 'vitest'
import { pin_verify_cli } from './pin-verify-cli'

const api_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/gh/git-gh-exec', () => ({ git_gh_exec: { exec_gh_api: api_mock } }))

// `josh pin:verify` — the three outcomes a SHA pin check can reach (joshuafolkken/kit#5849).

const REPO = 'actions/checkout'
const TAG = 'v4.2.2'
const TAG_REF = encodeURIComponent(`refs/tags/${TAG}`)
const PINNED = '11bd71901bbe5b1630ceea73d27597364c9af683'
const OTHER = '0000000000000000000000000000000000000001'

interface Captured {
	code: number
	out: string
}

async function run_and_capture(argv: ReadonlyArray<string>): Promise<Captured> {
	const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

	vi.spyOn(console, 'error').mockImplementation(() => undefined)
	const code = await pin_verify_cli.run(argv)

	return { code, out: info.mock.calls.flat().join('\n') }
}

beforeEach(() => {
	api_mock.mockReset()
	vi.restoreAllMocks()
})

describe('pin_verify_cli.run outcomes', () => {
	it('answers match and exits zero when the tag resolves to the pinned SHA', async () => {
		api_mock.mockResolvedValue(PINNED)

		const { code, out } = await run_and_capture([REPO, TAG, PINNED.toUpperCase()])

		expect(code).toBe(0)
		expect(out).toBe(`match — pin:verify: ${REPO}@${TAG} resolves to ${PINNED}, the pinned SHA`)
		expect(api_mock).toHaveBeenCalledWith({
			path: `repos/${REPO}/commits/${TAG_REF}`,
			jq_filter: '.sha',
		})
	})

	it('answers mismatch and exits non-zero when the tag resolves elsewhere', async () => {
		api_mock.mockResolvedValue(OTHER)

		const { code, out } = await run_and_capture([REPO, TAG, PINNED])

		expect(code).toBe(1)
		expect(out).toBe(
			`mismatch — pin:verify: ${REPO}@${TAG} resolves to ${OTHER}, not the pinned ${PINNED}`,
		)
	})

	it('answers unreadable and exits non-zero when the tag cannot be read', async () => {
		api_mock.mockRejectedValue(new Error('HTTP 404: No commit found for SHA: v9\n{"status":"422"}'))

		const { code, out } = await run_and_capture([REPO, 'v9', PINNED])

		expect(code).toBe(1)
		expect(out).toBe(
			`unreadable — pin:verify: ${REPO}@v9 could not be read: HTTP 404: No commit found for SHA: v9`,
		)
	})
})

describe('pin_verify_cli.run usage', () => {
	it('prints the usage and calls no API on malformed arguments', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

		expect(await pin_verify_cli.run([REPO, TAG])).toBe(1)
		expect(await pin_verify_cli.run(['not-a-repo', TAG, PINNED])).toBe(1)
		expect(await pin_verify_cli.run([REPO, TAG, 'abc123'])).toBe(1)
		expect(error).toHaveBeenCalledWith(pin_verify_cli.USAGE)
		expect(api_mock).not.toHaveBeenCalled()
	})
})
