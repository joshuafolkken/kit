import { stamp_file } from '#scripts/josh/stamp-file'
import { run_carry } from '#scripts/run/carry/run-carry'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, expect, it, vi } from 'vitest'
import { run_event_stream } from './run-event-stream'
import { run_event_stream_emit } from './run-event-stream-emit'

const DISK_FAILURE = 'Fixture disk failure'
const make_directory = temporary_directory('suite')

afterEach(() => {
	vi.restoreAllMocks()
})

it('refuses required issue history when the repository cannot be resolved', async () => {
	vi.spyOn(run_carry, 'repository_directory').mockResolvedValue(undefined)
	await expect(run_event_stream_emit.all_events(true)).rejects.toThrow(
		'resolve the run event stream',
	)
})

it('propagates a failed required history read without a carry scope', async () => {
	const directory = make_directory('required-history-')

	vi.spyOn(run_carry, 'repository_directory').mockResolvedValue(directory)
	stamp_file.write_text_stamp(run_event_stream.target_of(directory), '')
	vi.spyOn(run_event_stream, 'read_events').mockImplementation(() => {
		throw new Error(DISK_FAILURE)
	})
	await expect(run_event_stream_emit.all_events(true)).rejects.toThrow(DISK_FAILURE)
	expect(await run_event_stream_emit.all_events()).toStrictEqual([])
})

it('treats an absent stream as empty history without a previous attempt', async () => {
	vi.spyOn(run_carry, 'repository_directory').mockResolvedValue(make_directory('no-history-'))
	expect(await run_event_stream_emit.all_events(true)).toStrictEqual([])
})
