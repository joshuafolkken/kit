import { describe, expect, it } from 'vitest'
import { run_ship_args } from './run-ship-args'

const TITLE = 'Fix the thing #42'
const BODY_PATH = 'body.md'
const NOTIFY = ['--notify-message', 'done']
const BODY = ['--body-file', BODY_PATH]

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
			},
		})
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
		['no positional at all', []],
	])('refuses %s', (_label, argv) => {
		expect(run_ship_args.parse(argv)).toBeUndefined()
	})
})
