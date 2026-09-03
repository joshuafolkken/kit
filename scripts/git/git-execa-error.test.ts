import { describe, expect, it } from 'vitest'
import { create_spawn_error, get_exit_code, has_timed_out } from './git-execa-error'

const NOT_AN_ERROR = 'not an error'

describe('get_exit_code', () => {
	it('returns the numeric exitCode from an execa-like error', () => {
		const error = Object.assign(new Error('failed'), { exitCode: 128 })

		expect(get_exit_code(error)).toBe(128)
	})

	it('returns undefined when exitCode is not a number (signal termination)', () => {
		const error = Object.assign(new Error('killed'), { exitCode: undefined })

		expect(get_exit_code(error)).toBeUndefined()
	})

	it('returns undefined for an error without an exitCode field', () => {
		expect(get_exit_code(new Error('plain'))).toBeUndefined()
	})

	it('returns undefined for a non-object value', () => {
		expect(get_exit_code(NOT_AN_ERROR)).toBeUndefined()
	})
})

// Shared by the two spawns that pass a timeout — `gh` and `git push` (joshuafolkken/kit#1251).
// Telling a killed spawn from a rejected one is what decides whether a retry is worth anything.
describe('has_timed_out', () => {
	it('returns true when execa marked the spawn as killed on its budget', () => {
		const error = Object.assign(new Error('Command timed out'), { timedOut: true })

		expect(has_timed_out(error)).toBe(true)
	})

	it('returns false for a spawn that exited on its own', () => {
		const error = Object.assign(new Error('rejected'), { timedOut: false, exitCode: 1 })

		expect(has_timed_out(error)).toBe(false)
	})

	it('returns false for an error without a timedOut field', () => {
		expect(has_timed_out(new Error('plain'))).toBe(false)
	})

	it('returns false for a non-object value', () => {
		expect(has_timed_out(NOT_AN_ERROR)).toBe(false)
	})
})

describe('create_spawn_error', () => {
	// `git_command.push` branches on `cause.exit_code` rather than parsing the message, so the shape
	// is part of the contract: 128 there is what selects the `--set-upstream` retry.
	it('carries the exit code on cause as well as in the message', () => {
		const UPSTREAM_NOT_SET = 128
		const error = create_spawn_error('push', UPSTREAM_NOT_SET)

		expect(error.message).toBe('git push exited with code 128')
		expect(error.cause).toStrictEqual({ exit_code: '128' })
	})

	it('reports an unknown code when the process was killed by a signal', () => {
		expect(create_spawn_error('push', undefined).message).toBe('git push exited with code unknown')
	})
})
