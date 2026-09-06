import { describe, expect, it } from 'vitest'
import { lane_environment } from './lane-environment'

// joshuafolkken/kit#1490: the acceptance condition this file carries is that a lane gets **its own**
// `PORT_SEED` while everything else in the root's `.env` reaches it unchanged. A lane that inherited
// the seed verbatim would put every lane on one pair of ports, and a busy port fails without
// retrying — at the default six lanes that is E2E failing nearly always, not occasionally.

const COMMENT = '# personal, non-committed'
const BOT_TOKEN = 'TELEGRAM_BOT_TOKEN=abc:123'
const CHAT_ID = 'TELEGRAM_CHAT_ID=42'
const SESSION_LANG = 'JOSH_SESSION_LANG=ja'
const ROOT_SEED_LINE = 'PORT_SEED=5'
const LANE_SEED_LINE = 'PORT_SEED=7'
const ROOT_FILE = [COMMENT, BOT_TOKEN, CHAT_ID, ROOT_SEED_LINE, SESSION_LANG, ''].join('\n')
const LANE_SEED = 7
const ROOT_SEED = 5

describe('the lane .env', () => {
	it('carries every other key across untouched, comments included', () => {
		const content = lane_environment.lane_file_content(ROOT_FILE, LANE_SEED)

		expect(content).toContain(COMMENT)
		expect(content).toContain(BOT_TOKEN)
		expect(content).toContain(CHAT_ID)
		expect(content).toContain(SESSION_LANG)
	})

	it('replaces the seed in place rather than appending a second one', () => {
		const content = lane_environment.lane_file_content(ROOT_FILE, LANE_SEED)
		const seed_lines = content.split('\n').filter((line) => lane_environment.is_seed_line(line))

		expect(seed_lines).toStrictEqual([LANE_SEED_LINE])
		expect(content).not.toContain(ROOT_SEED_LINE)
	})

	it('appends a seed to a root file that had none', () => {
		const content = lane_environment.lane_file_content(`${CHAT_ID}\n`, LANE_SEED)

		expect(content).toBe(`${CHAT_ID}\n${LANE_SEED_LINE}\n`)
	})

	it('writes a seed even when the root has no .env at all', () => {
		expect(lane_environment.lane_file_content('', LANE_SEED)).toBe(`${LANE_SEED_LINE}\n`)
	})

	it('reads the exported form as the seed line, not as another key', () => {
		const content = lane_environment.lane_file_content(`export ${ROOT_SEED_LINE}\n`, LANE_SEED)

		expect(content).toBe(`${LANE_SEED_LINE}\n`)
	})

	it('leaves one seed line behind when the root carried two of them', () => {
		const content = lane_environment.lane_file_content(`PORT_SEED=\n${ROOT_SEED_LINE}\n`, LANE_SEED)

		expect(content).toBe(`${LANE_SEED_LINE}\n`)
	})

	it('leaves a key whose name merely starts with PORT_SEED alone', () => {
		const content = lane_environment.lane_file_content('PORT_SEED_BASE=5\n', LANE_SEED)

		expect(content).toBe(`PORT_SEED_BASE=5\n${LANE_SEED_LINE}\n`)
	})
})

describe('reading the root seed every lane is offset from', () => {
	it('reads the seed the root set', () => {
		expect(lane_environment.read_root_seed(ROOT_FILE)).toBe(ROOT_SEED)
	})

	it('reads a quoted value without its quotes', () => {
		expect(lane_environment.read_root_seed('PORT_SEED="5"\n')).toBe(ROOT_SEED)
	})

	it('reads a missing or blank seed as 0, the documented default', () => {
		expect(lane_environment.read_root_seed('')).toBe(0)
		expect(lane_environment.read_root_seed('PORT_SEED=\n')).toBe(0)
	})

	// `.env` is last-wins, so a root that kept the blank key from `.env.example` and appended a real
	// seed later would otherwise read as 0 here and as the real seed everywhere else — and the lane
	// band would run straight over the main work tree's own ports.
	it('takes the last assignment, the way every other reader of .env does', () => {
		expect(lane_environment.read_root_seed(`PORT_SEED=\n${ROOT_SEED_LINE}\n`)).toBe(ROOT_SEED)
	})

	// A silent fallback to 0 would put the lane on the root's own ports, which is the one outcome
	// this module exists to prevent — so the validation is `ports.resolve_seed`'s, not a copy of it.
	it('throws on a malformed seed rather than falling back', () => {
		expect(() => lane_environment.read_root_seed('PORT_SEED=abc\n')).toThrow('PORT_SEED')
	})
})
