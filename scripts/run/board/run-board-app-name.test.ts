import { describe, expect, it } from 'vitest'
import { run_board_app_name } from './run-board-app-name'

// joshuafolkken/kit#4171: an app is named by its bundle, else by its command.

const { app_of } = run_board_app_name

describe('run_board_app_name.app_of', () => {
	it('names an app by its outermost bundle, else by its command', () => {
		expect(app_of('/Applications/Google Chrome.app/Contents/Frameworks/Helper.app/Helper')).toBe(
			'Google Chrome',
		)
		expect(app_of('/usr/bin/git')).toBe('git')
		expect(app_of('/Library/Application Support/foo/bar')).toBe('bar')
		expect(app_of('eslint_d - /Users/me/.kit-lanes/4130')).toBe('eslint_d')
	})
})
