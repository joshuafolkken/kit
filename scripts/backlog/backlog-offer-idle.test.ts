import { git_command } from '#scripts/git/git-command'
import { josh_command } from '#scripts/josh/josh-run'
import { shared_cache_fixture } from '#scripts/josh/shared-cache-fixture'
import { lane_registry } from '#scripts/lane/lane-registry'
import { rule_value_cache } from '#scripts/rules/rule-value-cache'
import { run_board_setup } from '#scripts/run/board/run-board-setup'
import { run_event_setup } from '#scripts/run/event/run-event-setup'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { temporary_directory } from '#tools/test/temporary-directory'
import { beforeEach, expect, it, vi } from 'vitest'
import { backlog_next_shared } from './backlog-next-shared'
import { backlog_offer_cli } from './backlog-offer-cli'

const make_directory = temporary_directory('suite')
const STARTED = '2026-11-12T15:14:54.021Z'
const { STAGE } = run_event_setup
const { DRAIN } = run_event_stream.EVENT_KIND
const fixture = { repository: '' }

beforeEach(() => {
	fixture.repository = make_directory('backlog-offer-idle-')
	vi.spyOn(git_command, 'git_directories').mockResolvedValue([
		fixture.repository,
		fixture.repository,
	])
	vi.spyOn(lane_registry, 'main_repository_root').mockResolvedValue(fixture.repository)
	vi.spyOn(rule_value_cache, 'emit').mockResolvedValue(undefined)
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
	vi.spyOn(josh_command, 'josh_run').mockResolvedValue({ code: 0, out: 'wait' })
	vi.spyOn(josh_command, 'josh_run_at').mockResolvedValue({ code: 0, out: '' })

	return shared_cache_fixture.isolate_shared_cache(backlog_next_shared.NEXT_CACHE)
})

function events(): ReturnType<typeof run_event_stream.read_events> {
	return run_event_stream.read_events(run_event_stream.target_of(fixture.repository))
}

async function offer(): Promise<number> {
	vi.mocked(josh_command.josh_run).mockResolvedValueOnce({ code: 0, out: 'wait' })
	vi.mocked(josh_command.josh_run).mockResolvedValueOnce({
		code: 0,
		out: JSON.stringify({ budget: 'watch', reason: 'waiting', is_finish: false }),
	})

	return await backlog_offer_cli.run(['--started', STARTED, '--json'])
}

it('keeps idle visible after failed maintenance and does not repeat it at the next handoff', async () => {
	vi.mocked(josh_command.josh_run_at).mockImplementation(async (argv) => {
		expect(run_board_setup.read(events()).setup).toBeUndefined()
		expect(events().some((event) => event.kind === DRAIN)).toBe(false)

		return { code: argv[0] === 'main:sync' ? 0 : 1, out: '', err: 'push failed' }
	})
	await run_event_setup.emit(STAGE.HANDING_OFF)
	expect(await offer()).toBe(0)
	await run_event_setup.emit(STAGE.HANDING_OFF)
	expect(await offer()).toBe(0)

	expect(events().filter((event) => event.text === STAGE.WATCHING)).toHaveLength(1)
	expect(events().filter((event) => event.kind === DRAIN)).toHaveLength(1)
	expect(josh_command.josh_run_at).toHaveBeenCalledTimes(2)
	expect(run_board_setup.read(events()).setup).toBeUndefined()
	expect(console.error).toHaveBeenCalledWith('observations:flush skipped: push failed')
})
