import { cases } from '#scripts/cases/cases-logic'
import { describe, expect, it } from 'vitest'
import { http_fault_injection } from './http-fault-injection'

// joshuafolkken/kit#2355: the injector makes `josh cases`' network vocabulary executable. These tests
// pin two things: that the set of injectable failures equals that vocabulary (so the two cannot drift)
// and that each mode produces the failure a caller's error path must survive.

const NON_200_STATUS = 500
const RATE_LIMIT_STATUS = 429

async function rejection(mode: string): Promise<unknown> {
	try {
		await http_fault_injection.faulty_fetch(mode)()

		return undefined
	} catch (error) {
		return error
	}
}

describe('http_fault_injection — correspondence with josh cases', () => {
	it('injects exactly the network vocabulary the command prints', () => {
		expect(http_fault_injection.supported_modes()).toEqual(cases.cases_for(['network']))
	})
})

describe('http_fault_injection.faulty_fetch — status failures', () => {
	it.each([
		['非200', NON_200_STATUS],
		['レート制限', RATE_LIMIT_STATUS],
	])('answers %s as a non-ok response carrying its status', async (mode, code) => {
		const response = await http_fault_injection.faulty_fetch(mode)()

		expect(response.ok).toBe(false)
		expect(response.status).toBe(code)
	})
})

describe('http_fault_injection.faulty_fetch — rejection failures', () => {
	it('answers the timeout mode as a TimeoutError, as AbortSignal.timeout would', async () => {
		const error = await rejection('タイムアウト')

		expect(error).toBeInstanceOf(DOMException)
		expect((error as DOMException).name).toBe('TimeoutError')
	})

	it('answers the connection-drop mode as a TypeError, as a dropped transport would', async () => {
		expect(await rejection('接続断')).toBeInstanceOf(TypeError)
	})
})

describe('http_fault_injection.faulty_fetch — body failures', () => {
	it('answers the empty-response mode as an ok response with an empty body', async () => {
		const response = await http_fault_injection.faulty_fetch('空レスポンス')()

		expect(response.ok).toBe(true)
		expect(await response.text()).toBe('')
	})

	it('answers the invalid-JSON mode as an ok response whose body is present but unparsable', async () => {
		const response = await http_fault_injection.faulty_fetch('不正JSON')()

		expect(response.ok).toBe(true)
		expect(await response.text()).not.toBe('')
	})

	it('rejects a mode it does not recognize rather than doing nothing', () => {
		expect(() => http_fault_injection.faulty_fetch('unknown')).toThrow('unknown')
	})
})
