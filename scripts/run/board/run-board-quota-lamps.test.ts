import { stripVTControlCharacters } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_quota_lamps } from './run-board-quota-lamps'
import { run_board_render_quota } from './run-board-render-quota'
import { run_board_spot } from './run-board-spot'

// joshuafolkken/kit#8277: the usage section's part of the WOPR lamp panel — the blank line above its rule
// and its first two provider rows, none on GitHub's row.

const { gap_line, provider_rows } = run_board_quota_lamps
const { LAMP_START } = run_board_spot
const ROWS = ['claude', 'codex', 'github']
// The red rows' out color before joshuafolkken/kit#8305.
const OUT_RED = '38;2;128;35;29'
const OUT_YELLOW = '38;2;128;107;5'
const NOW_MS = Date.parse('2026-11-20T09:00:00.000Z')

afterEach(() => {
	vi.unstubAllEnvs()
})

describe('run_board_quota_lamps', () => {
	it('starts a panel on the blank line and the first two provider rows where the frame has lamps', () => {
		const rows = provider_rows(ROWS, true).map((row) => stripVTControlCharacters(row))

		expect(stripVTControlCharacters(gap_line(true))).toBe(` ${LAMP_START}`)
		expect(rows).toStrictEqual([`claude ${LAMP_START}`, `codex ${LAMP_START}`, 'github'])
	})

	it('starts the blank line and both provider rows out in half yellow, never half red', () => {
		vi.stubEnv('FORCE_COLOR', '3')
		const [first = '', second = ''] = provider_rows(ROWS, true)

		for (const line of [gap_line(true), first, second]) {
			expect(line).toContain(OUT_YELLOW)
			expect(line).not.toContain(OUT_RED)
		}
	})

	it('leaves the blank line and the rows as they were where the frame has none', () => {
		expect(gap_line(false)).toBe('')
		expect(provider_rows(ROWS, false)).toStrictEqual(ROWS)
	})
})

describe('run_board_render_quota.usage_part with lamps', () => {
	const QUOTAS = { claude: undefined, codex: undefined }

	it('draws the usage section as before where the frame has no lamps', () => {
		const plain = run_board_render_quota.usage_part({ quotas: QUOTAS, now_ms: NOW_MS })
		const unlit = run_board_render_quota.usage_part({
			quotas: QUOTAS,
			now_ms: NOW_MS,
			has_lamps: false,
		})

		expect(unlit).toStrictEqual(plain)
		expect(plain?.head[0]).toBe('')
	})

	it('starts the panel on its blank line and provider rows where the frame has lamps', () => {
		const part = run_board_render_quota.usage_part({
			quotas: QUOTAS,
			now_ms: NOW_MS,
			has_lamps: true,
		})
		const lines = [part?.head[0] ?? '', ...(part?.lines.map((line) => line.text) ?? [])]

		expect(lines.filter((line) => line.includes(LAMP_START))).toHaveLength(3)
	})
})
