import { stamp_file } from '#scripts/josh/stamp-file'
import { temporary_directory } from '#tools/test/temporary-directory'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// joshuafolkken/kit#7020: a round 1 the ship runs starts the paired Sonnet reviewer beside the code
// reviewer, never gating it, and names both headless sessions for `josh review:pair`.

const argv_mock = vi.hoisted(() => vi.fn())
const launch_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/agent/agent-argv', () => ({ agent_argv: { with_profile_in: argv_mock } }))
vi.mock('#scripts/run/detached-launch', () => ({
	detached_launch: { launch_attached: launch_mock },
}))

const { review_pair } = await import('./review-pair')
const { review_pair_session } = await import('./review-pair-session')

const ON = { [review_pair.PAIRED_ENV]: '1' }
const BRIEF = 'medium — review brief\nReview round: 1'
const ENVIRONMENT = { JOSH_LANE: '7020' }
const ISSUE = '7020'
const DIRECTORY_PREFIX = 'review-pair-session-'
const MISSING_LOG = '/no/such/log'
const OPUS_SESSION = 'opus-session'
const SONNET_SESSION = 'sonnet-session'
const make_directory = temporary_directory()

function init_line(session_id: string): string {
	return JSON.stringify({ type: 'system', subtype: 'init', session_id })
}

function paired_directory(): string {
	const directory = make_directory(DIRECTORY_PREFIX)

	review_pair.offer(BRIEF, ON, directory)

	return directory
}

beforeEach(() => {
	argv_mock.mockReset().mockReturnValue({
		kind: 'argv',
		argv: { command: 'claude', args: [] },
		profile: review_pair.PAIRED_PROFILE,
	})
	launch_mock.mockReset().mockResolvedValue({ kind: 'completed', pid: 1, exit_code: 0 })
	vi.spyOn(process.stderr, 'write').mockReturnValue(true)
})

describe('review_pair_session.launch', () => {
	it('starts nothing while the round is unpaired', async () => {
		await review_pair_session.launch(make_directory(DIRECTORY_PREFIX), ENVIRONMENT)

		expect(launch_mock).not.toHaveBeenCalled()
	})

	it('starts the Sonnet reviewer on the paired brief, logging to its own file', async () => {
		const directory = paired_directory()
		const { brief, log } = review_pair.paths(directory)

		await review_pair_session.launch(directory, ENVIRONMENT)

		expect(argv_mock).toHaveBeenCalledWith(
			expect.stringContaining(brief),
			review_pair.PAIRED_PROFILE,
			directory,
		)
		expect(launch_mock.mock.calls[0]?.[0]).toMatchObject({
			cwd: directory,
			log_path: log,
			env: ENVIRONMENT,
		})
	})

	it('settles when the launch throws, so the code round never fails with it', async () => {
		launch_mock.mockRejectedValue(new Error('spawn failed'))

		await expect(
			review_pair_session.launch(paired_directory(), ENVIRONMENT),
		).resolves.toBeUndefined()
	})
})

describe('review_pair_session.session_of', () => {
	it("reads the log's latest session id past its header and other events", () => {
		const { log } = review_pair.paths(make_directory(DIRECTORY_PREFIX))
		const lines = ['=== launch header', init_line('old'), '{"type":"result"}', init_line('new')]

		stamp_file.write_text_stamp(log, `${lines.join('\n')}\n`)

		expect(review_pair_session.session_of(log)).toBe('new')
	})

	it('reads nothing from a missing log', () => {
		expect(review_pair_session.session_of(MISSING_LOG)).toBeUndefined()
	})
})

describe('review_pair_session.pair_argv', () => {
	it('names both sessions of a paired round for review:pair', () => {
		const directory = paired_directory()
		const code_log = `${review_pair.paths(directory).log}.code`

		stamp_file.write_text_stamp(code_log, `${init_line(OPUS_SESSION)}\n`)
		stamp_file.write_text_stamp(review_pair.paths(directory).log, `${init_line(SONNET_SESSION)}\n`)

		expect(review_pair_session.pair_argv(ISSUE, code_log, directory)).toStrictEqual([
			'review:pair',
			'--issue',
			ISSUE,
			'--opus-agent',
			OPUS_SESSION,
			'--sonnet-agent',
			SONNET_SESSION,
		])
	})

	it('records nothing for an unpaired round or a session that left no id', () => {
		const directory = paired_directory()

		expect(review_pair_session.pair_argv(ISSUE, MISSING_LOG, directory)).toBeUndefined()
		expect(
			review_pair_session.pair_argv(ISSUE, MISSING_LOG, make_directory(DIRECTORY_PREFIX)),
		).toBeUndefined()
	})
})
