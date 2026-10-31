import { describe, expect, it } from 'vitest'
import { run_board_labels } from './run-board-labels'
import { run_board_render_fixture } from './run-board-render-fixture'
import { run_board_render_none } from './run-board-render-none'

const { WORDS } = run_board_labels
const { NOW } = run_board_render_fixture
const { render_no_run } = run_board_render_none
const FOOTER = ['footer']

describe('run_board_render_none.render_no_run', () => {
	it('says no run on its one line when the reads did not fail', () => {
		const [line = ''] = render_no_run(NOW)

		expect(line.startsWith('■ backlogrun')).toBe(true)
		expect(line).toContain(WORDS.no_run)
	})

	it('says why the read failed in place of no run', () => {
		const [line = ''] = render_no_run(NOW, {}, { read_failed_ms: NOW, read_error: 'gone' })

		expect(line).not.toContain(WORDS.no_run)
		expect(line).toContain('gone')
	})

	it('ends on the footer it is given', () => {
		expect(render_no_run(NOW, { footer: FOOTER }).at(-1)).toBe('footer')
	})
})
