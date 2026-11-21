import { session_language } from '#scripts/josh/session-language'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_ship_park_prose } from './run-ship-park-prose'

// joshuafolkken/kit#7709: a `josh ship` supervisor park writes its prose in the session language.

const ISSUE = '7709'
const REASON = 'followup'
const LOG = `pnpm josh ship --log ${ISSUE}`
const SUPERVISOR = '`josh ship` の監督役が park しました'

afterEach(() => {
	vi.unstubAllEnvs()
})

describe('run_ship_park_prose in Japanese', () => {
	it.each(['ja', ''])('writes the prose in Japanese under %j', (lang) => {
		vi.stubEnv(session_language.ENV_KEY, lang)

		expect(run_ship_park_prose.cap({ reason: REASON, kind: 'review', relaunches: '4' })).toEqual({
			lead: expect.stringContaining(`${SUPERVISOR}: dispatch 以降、レビュー停止`) as unknown,
			body: expect.stringContaining('上限 4 回を超え') as unknown,
		})
		expect(run_ship_park_prose.timed_out(REASON).lead).toContain('マージ待ちが時間切れ')
		expect(run_ship_park_prose.ci_infra(REASON).body).toContain('CI の基盤障害')
		expect(run_ship_park_prose.next_step(ISSUE)).toContain(`\`${LOG}\` で停止を読み`)
	})

	it('keeps the stage and the resume commands English', () => {
		vi.stubEnv(session_language.ENV_KEY, 'ja')

		expect(run_ship_park_prose.timed_out(REASON).lead).toContain(`\`${REASON}\``)
		expect(run_ship_park_prose.next_step(ISSUE)).toContain(`pnpm josh run:add ${ISSUE}`)
	})
})

describe('run_ship_park_prose in English', () => {
	it('writes the prose in English under en', () => {
		vi.stubEnv(session_language.ENV_KEY, 'en')

		expect(
			run_ship_park_prose.cap({ reason: REASON, kind: 'mechanical', relaunches: '4' }).lead,
		).toContain('the mechanical stop cap was exceeded')
		expect(run_ship_park_prose.timed_out(REASON).body).toContain('The merge wait at followup')
		expect(run_ship_park_prose.ci_infra(REASON).lead).toContain('Resume it once CI recovers.')
		expect(run_ship_park_prose.next_step(ISSUE)).toContain(`Read the stop with \`${LOG}\``)
	})
})
