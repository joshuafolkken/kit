import { describe, expect, it } from 'vitest'
import { gh_failure } from './git-gh-failure'

// joshuafolkken/kit#1690: the failure's nature has to come from the request that failed. Everything
// below is about the one place it is available there — the response body `gh api` writes to stdout.

const NOT_FOUND_STATUS = 404
const RATE_LIMITED_STATUS = 429
const NOT_FOUND_MESSAGE = 'gh: Not Found'

// Measured against a real `gh api repos/joshuafolkken/kit/issues/99999999`: stderr carries the one
// summary line, and **stdout carries GitHub's error document, which names its own status**.
const NOT_FOUND_DOCUMENT =
	'{"message":"Not Found","documentation_url":"https://docs.github.com/rest/issues/issues#get-an-issue","status":"404"}'

// Measured against `GH_HOST=nonexistent.invalid gh api …`: stderr says the connection failed and
// **stdout is empty**, because nothing answered.
const NOTHING_ANSWERED = ''

describe('parse_response_status', () => {
	it('reads the status GitHub wrote in its own error document', () => {
		expect(gh_failure.parse_response_status(NOT_FOUND_DOCUMENT)).toBe(NOT_FOUND_STATUS)
	})

	it('reads a status served as a number as readily as one served as a string', () => {
		expect(gh_failure.parse_response_status('{"status":429}')).toBe(RATE_LIMITED_STATUS)
	})

	// A request that never arrived wrote no response body at all, which is the transport case.
	it('answers nothing for a request that produced no response body', () => {
		expect(gh_failure.parse_response_status(NOTHING_ANSWERED)).toBeUndefined()
	})

	// Something came back, but nothing in it says what the status was. Guessing one would be the
	// inference this module exists to remove.
	it('answers nothing for a response that is not GitHub error document', () => {
		expect(gh_failure.parse_response_status('<html>proxy error</html>')).toBeUndefined()
		expect(gh_failure.parse_response_status('{"message":"Not Found"}')).toBeUndefined()
	})

	// A JSON value that is not an object at all must not throw out of a classification that runs on
	// the failure path, where a second exception has nowhere left to go.
	it('answers nothing rather than throwing for JSON that is not an object', () => {
		expect(gh_failure.parse_response_status('null')).toBeUndefined()
		expect(gh_failure.parse_response_status('[1,2]')).toBeUndefined()
	})

	it('answers nothing for a status that is not a whole number', () => {
		expect(gh_failure.parse_response_status('{"status":"soon"}')).toBeUndefined()
	})
})

describe('attach and failure_of', () => {
	it('carries the classification through the throw the caller catches', () => {
		const error = gh_failure.attach(new Error(NOT_FOUND_MESSAGE), { status: NOT_FOUND_STATUS })

		expect(gh_failure.failure_of(error)).toEqual({ status: NOT_FOUND_STATUS })
	})

	// An error that carries none did not come from the request: a parse or a schema rejection is a
	// read that arrived and could not be used.
	it('answers nothing for an error no request classified', () => {
		expect(gh_failure.failure_of(new Error('not an issue object'))).toBeUndefined()
	})

	it('answers nothing for a value that is not an error at all', () => {
		expect(gh_failure.failure_of(NOT_FOUND_MESSAGE)).toBeUndefined()
	})

	// An error is compared, logged and serialized all over this project, and an annotation nobody
	// asked for must not change what any of that sees.
	it('leaves the error equal to a plain one of the same message', () => {
		const error = gh_failure.attach(new Error(NOT_FOUND_MESSAGE), { status: NOT_FOUND_STATUS })

		expect(error).toEqual(new Error(NOT_FOUND_MESSAGE))
	})
})

describe('classify_stdout', () => {
	it('classifies a refused request by the status it answered with', () => {
		expect(gh_failure.classify_stdout(NOT_FOUND_DOCUMENT)).toEqual({ status: NOT_FOUND_STATUS })
	})

	it('classifies a request nothing answered as carrying no status', () => {
		expect(gh_failure.classify_stdout(NOTHING_ANSWERED)).toEqual({ status: undefined })
	})
})
