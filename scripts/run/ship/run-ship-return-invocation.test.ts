import { expect, it, vi } from 'vitest'

const mark_stop = vi.hoisted(() => vi.fn())

vi.mock('./run-ship-detach', () => ({ run_ship_detach: { mark_stop } }))
vi.mock('./run-ship-probe', () => ({
	run_ship_probe: {
		repository_directory: async () => 'repository',
		read_review_stale: async () => true,
	},
}))
vi.mock('#scripts/run/event/run-event-stream-emit', () => ({
	run_event_stream_emit: { emit: vi.fn() },
}))
vi.mock('#scripts/lane/lane-child-marker', () => ({
	lane_child_marker: { is_child_of: () => false },
}))

const { run_ship_return } = await import('./run-ship-return')

it('records the generated resume invocation before deferring to the OpenAI supervisor', async () => {
	const args = {
		number: '5473',
		title: 'Resume followup #5473',
		notify: [],
		body: ['--body-file', 'body.md'],
		body_path: 'body.md',
		cites: ['5451'],
		is_review: true,
		is_detach: true,
		unpinned_ok: ['--unpinned-ok', 'reason'],
	}

	await expect(run_ship_return.hand_back(args, 'followup', { body: 'read failed' })).resolves.toBe(
		'recorded',
	)
	expect(mark_stop).toHaveBeenCalledWith(
		'repository',
		'5473',
		expect.stringContaining(
			"ship --detach --review --unpinned-ok reason --body-file body.md --cite 5451 'Resume followup #5473'",
		),
	)
})
