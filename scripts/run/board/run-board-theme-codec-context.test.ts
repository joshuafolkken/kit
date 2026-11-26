import { describe, expect, it } from 'vitest'
import { run_board_theme_codec_context } from './run-board-theme-codec-context'
import { run_board_theme_host_fixture } from './run-board-theme-host-fixture'

// joshuafolkken/kit#8917: the places the METAL GEAR theme derives from the board's layout.

const { codec_of, lane_of } = run_board_theme_codec_context
const { HOST } = run_board_theme_host_fixture

describe('run_board_theme_codec_context.lane_of', () => {
	it('reads the stage, the title up to the blanks before the arrow, and the estimate', () => {
		const lane = lane_of('BD  1 2 ** Ship the codec  ->  19:39 +2′')

		expect(lane).toStrictEqual({ stage: 'BD', title: 'Ship the codec', eta: '--:--' })
		expect(lane_of('BD ** a  -> 19:39').eta).toBe('19:39')
	})

	it('cuts the title to 30 columns and keeps an empty title when there is none', () => {
		expect(lane_of(`BD ** ${'x'.repeat(40)}  -> 01:02`).title).toBe('x'.repeat(30))
		expect(lane_of('BD no title here').title).toBe('')
	})
})

describe('run_board_theme_codec_context.codec_of', () => {
	const codec = codec_of(HOST.api)

	it('places the three radars from the edge and the area', () => {
		const { edge, area_top, area_end } = HOST.layout
		const area_h = area_end - area_top + 1

		expect(codec.small_radar).toStrictEqual({ x: edge - 25, y: 5, w: 25, h: 7 })
		expect(codec.big_radar).toStrictEqual({ x: 0, y: area_top, w: edge, h: area_h })
		expect(codec.side_radar).toStrictEqual({ x: edge - 30, y: area_top, w: 30, h: area_h })
	})

	it('centres the codec on the screen', () => {
		expect(codec.codec_at).toStrictEqual({
			x: HOST.layout.screen_cx - 29,
			y: HOST.layout.screen_cy - 5,
		})
	})

	it('writes the mission log from the new lane', () => {
		expect(codec.log_lines[0]).toStrictEqual(['CONTACT', `NEW LANE #${HOST.layout.new_lane}`])
		expect(codec.log_lines[3]?.[1]).toBe(`-> ${codec.lane.eta}`)
	})

	it('puts "!" four columns before the notice and "?" at the lane, repeating', () => {
		expect(codec.alert_mark.x).toBe(HOST.layout.notice.x - 4)
		expect(codec.alert_mark.repeat).toBeUndefined()
		expect(codec.query_mark).toMatchObject({ glyph: '?', x: 1, repeat: 40 })
	})
})
