import { describe, expect, it } from 'vitest'
import { run_board_render_fixture } from './run-board-render-fixture'
import { run_board_render_foot } from './run-board-render-foot'

const { header } = run_board_render_fixture
const { legend_lines, resume_lines, thanks_part } = run_board_render_foot

describe('run_board_render_foot.resume_lines', () => {
	it('draws the resume command after a blank line for a stopped run', () => {
		expect(resume_lines('abc')).toStrictEqual(['', expect.stringContaining('claude --resume abc')])
	})

	it('draws nothing for a run with no session to resume', () => {
		expect(resume_lines(undefined)).toStrictEqual([])
	})
})

describe('run_board_render_foot.legend_lines', () => {
	it('draws no legend before a plan is read', () => {
		expect(legend_lines(header({ layout: undefined }), [])).toStrictEqual([])
	})
})

describe('run_board_render_foot.thanks_part', () => {
	it('draws no thanks where there are none', () => {
		expect(thanks_part(undefined, undefined, undefined)).toStrictEqual([])
	})
})
