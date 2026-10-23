import { describe, expect, it } from 'vitest'
import { run_ship_args } from './run-ship-args'

const TITLE = 'Fix the thing #42'
const BODY_PATH = 'body.md'
const NOTIFY = ['--notify-message', 'done']
const BODY = ['--body-file', BODY_PATH]
const UNPINNED_OK = '--unpinned-ok'
const REASON = 'removes dead code'

describe('run_ship_args.parse — a ship', () => {
	it('reads the issue number off the title tail and forwards every option', () => {
		const argv = [TITLE, '7', '--cite', '8', ...BODY, ...NOTIFY]

		expect(run_ship_args.parse([...argv, '--review', '--detach'])).toStrictEqual({
			kind: 'ship',
			args: {
				title: TITLE,
				number: '42',
				notify: NOTIFY,
				body: BODY,
				body_path: BODY_PATH,
				cites: ['7', '8'],
				is_review: true,
				is_detach: true,
				unpinned_ok: [],
			},
		})
	})

	it('carries --unpinned-ok and its reason as the tokens round 1 forwards to run:review', () => {
		const unpinned_ok = [UNPINNED_OK, REASON]
		const parsed = run_ship_args.parse([TITLE, '--review', ...unpinned_ok])

		expect(parsed).toMatchObject({ kind: 'ship', args: { unpinned_ok } })
	})
})

describe('run_ship_args.parse — the log and the refusals', () => {
	it('reads a bare --log as the log command', () => {
		expect(run_ship_args.parse(['--log', '42'])).toStrictEqual({ kind: 'log', number: '42' })
	})

	it.each([
		['a title without an issue number', ['Fix the thing']],
		['a citation that is not an issue number', [TITLE, '--x']],
		['a --log with a positional', ['--log', '42', TITLE]],
		['--unpinned-ok without --review', [TITLE, UNPINNED_OK, REASON]],
		['--unpinned-ok with a blank reason', [TITLE, '--review', UNPINNED_OK, ' ']],
		['no positional at all', []],
	])('refuses %s', (_label, argv) => {
		expect(run_ship_args.parse(argv)).toBeUndefined()
	})
})
