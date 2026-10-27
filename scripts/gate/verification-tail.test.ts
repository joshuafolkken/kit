import { status_icons } from '#scripts/lib/status-icons'
import { describe, expect, it } from 'vitest'
import { gate_log } from './gate-log'
import { verification_tail } from './verification-tail'

const { FAIL_ICON, PASS_ICON } = status_icons
const LOG_PATH = 'logs/josh-check-log.log'
const LINT_RELATED = 'lint:related'

describe('verification_tail.format_verdict', () => {
	it('says the command passed when nothing failed', () => {
		expect(verification_tail.format_verdict(LINT_RELATED, [])).toBe(
			`${PASS_ICON} lint:related passed`,
		)
	})

	it('names everything that failed', () => {
		expect(verification_tail.format_verdict('check:related', [LINT_RELATED, 'cspell:dot'])).toBe(
			`${FAIL_ICON} check:related failed: lint:related, cspell:dot`,
		)
	})
})

describe('verification_tail.format_rerun', () => {
	it('names the failure and the command that reproduces it', () => {
		expect(verification_tail.format_rerun('lint', 'pnpm lint')).toBe(
			`  ${FAIL_ICON} lint — re-run: pnpm lint`,
		)
	})
})

describe('verification_tail.format_tail', () => {
	it('puts the failures, then the log notice, then the verdict last', () => {
		const tail = verification_tail.format_tail({
			failures: 'x — next:\n  a\n',
			log: { path: LOG_PATH },
			verdict: 'VERDICT',
		})

		expect(tail).toBe(`x — next:\n  a\n${gate_log.LOG_NOTICE_PREFIX}${LOG_PATH}\nVERDICT\n`)
	})

	it('says so when the log could not be written', () => {
		const tail = verification_tail.format_tail({
			failures: '',
			log: { path: undefined },
			verdict: 'VERDICT',
		})

		expect(tail).toBe(`${gate_log.LOG_FAILED_NOTICE}\nVERDICT\n`)
	})

	it('prints no log notice for a check that keeps no log', () => {
		expect(verification_tail.format_tail({ failures: '', verdict: 'VERDICT' })).toBe('VERDICT\n')
	})
})
