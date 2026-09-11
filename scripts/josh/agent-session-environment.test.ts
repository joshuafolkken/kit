import { agent_session_environment } from '#scripts/josh/agent-session-environment'
import { describe, expect, it } from 'vitest'

// joshuafolkken/kit#1760. A woken `backlogrun` session inherited the loopback proxy the package
// manager that launched its supervisor had stood up, kept dialling it long after that invocation
// had exited, and died with `API Error: Unable to connect to API (ConnectionRefused)` about three
// minutes in — every time, so the backlog stopped at its first session cut. These pin both halves:
// a loopback proxy goes, and a proxy naming a real host stays.

const LOOPBACK_PROXY = 'http://localhost:52554'
const HOST_PROXY = 'https://proxy.example.com:8080'
const CERTIFICATE_PATH = '/Users/somebody/.safe-chain/certs/ca-cert.pem'
const NO_ENVIRONMENT: Readonly<Record<string, string | undefined>> = {}

describe('agent_session_environment.removed_environment — the parent session', () => {
	// Two copies of this list is the clone that fails silently: the child dials the parent's private
	// socket and the session dies with nothing naming the cause (joshuafolkken/kit#1158).
	it('removes each parent-session variable rather than blanking it', () => {
		const removed = agent_session_environment.removed_environment(NO_ENVIRONMENT)

		expect(Object.keys(removed)).toStrictEqual([...agent_session_environment.PARENT_SESSION_KEYS])
		expect(JSON.stringify(removed)).toBe('{}')
	})

	it('names the messaging socket and token, which are the two that kill a child session', () => {
		expect(agent_session_environment.PARENT_SESSION_KEYS).toContain('CLAUDE_CODE_MESSAGING_SOCKET')
		expect(agent_session_environment.PARENT_SESSION_KEYS).toContain('CLAUDE_CODE_MESSAGING_TOKEN')
	})
})

describe('agent_session_environment.removed_environment — a launcher-scoped proxy', () => {
	it('removes a loopback proxy, which cannot outlive the invocation that stood it up', () => {
		const removed = agent_session_environment.removed_environment({ HTTPS_PROXY: LOOPBACK_PROXY })

		expect(Object.keys(removed)).toContain('HTTPS_PROXY')
	})

	// Named literally rather than iterated: a test that walks the list it is checking passes just as
	// happily when a spelling is missing from it, and the one left behind is the one the client obeys.
	it('names every spelling a client may obey', () => {
		expect([...agent_session_environment.PROXY_KEYS]).toStrictEqual([
			'ALL_PROXY',
			'HTTP_PROXY',
			'HTTPS_PROXY',
			'all_proxy',
			'http_proxy',
			'https_proxy',
			'GLOBAL_AGENT_HTTP_PROXY',
			'GLOBAL_AGENT_HTTPS_PROXY',
		])
	})

	it('removes every one of them when each names a loopback address', () => {
		const source = Object.fromEntries(
			agent_session_environment.PROXY_KEYS.map((key) => [key, LOOPBACK_PROXY]),
		)
		const removed = Object.keys(agent_session_environment.removed_environment(source))

		for (const key of agent_session_environment.PROXY_KEYS) expect(removed).toContain(key)
	})
})

describe('agent_session_environment.removed_environment — how a proxy value is read', () => {
	// `HTTPS_PROXY=localhost:52554` is what curl and npm accept, and `new URL` reads it as a scheme
	// with no host — so a single parse hands exactly this dead address on as "not a loopback proxy".
	it('reads a value written without a scheme', () => {
		const removed = agent_session_environment.removed_environment({
			HTTPS_PROXY: 'localhost:52554',
		})

		expect(Object.keys(removed)).toContain('HTTPS_PROXY')
	})

	it('reads the whole of the loopback range, not just its first address', () => {
		const removed = agent_session_environment.removed_environment({
			HTTPS_PROXY: 'http://127.0.0.2:52554',
		})

		expect(Object.keys(removed)).toContain('HTTPS_PROXY')
	})

	it('removes the certificate beside the proxy it exists to make verifiable', () => {
		const removed = agent_session_environment.removed_environment({
			HTTPS_PROXY: LOOPBACK_PROXY,
			NODE_EXTRA_CA_CERTS: CERTIFICATE_PATH,
		})

		expect(Object.keys(removed)).toContain(agent_session_environment.PROXY_CERTIFICATE_KEY)
	})
})

describe('agent_session_environment.removed_environment — what it must not take', () => {
	// The far more damaging mistake of the two: a machine that reaches the API only through its
	// network's proxy would be cut off from it entirely.
	it('leaves a proxy naming a real host exactly as it was', () => {
		const removed = agent_session_environment.removed_environment({
			HTTPS_PROXY: HOST_PROXY,
			NODE_EXTRA_CA_CERTS: CERTIFICATE_PATH,
		})

		expect(Object.keys(removed)).not.toContain('HTTPS_PROXY')
		expect(Object.keys(removed)).not.toContain(agent_session_environment.PROXY_CERTIFICATE_KEY)
	})

	// The mixed environment is the one that breaks a person outright: their corporate proxy survives
	// while the trust store that makes its interception verifiable does not, so every request fails.
	it('keeps the certificate when a proxy it may certify is left standing', () => {
		const removed = Object.keys(
			agent_session_environment.removed_environment({
				HTTP_PROXY: LOOPBACK_PROXY,
				HTTPS_PROXY: HOST_PROXY,
				NODE_EXTRA_CA_CERTS: CERTIFICATE_PATH,
			}),
		)

		expect(removed).toContain('HTTP_PROXY')
		expect(removed).not.toContain('HTTPS_PROXY')
		expect(removed).not.toContain(agent_session_environment.PROXY_CERTIFICATE_KEY)
	})

	it('leaves the certificate alone when the environment declares no proxy at all', () => {
		const removed = agent_session_environment.removed_environment({
			NODE_EXTRA_CA_CERTS: CERTIFICATE_PATH,
		})

		expect(Object.keys(removed)).not.toContain(agent_session_environment.PROXY_CERTIFICATE_KEY)
	})
})

describe('agent_session_environment.removed_environment — the spellings it has to reach', () => {
	it('reads a value that is not a URL as no proxy at all, rather than throwing', () => {
		const removed = agent_session_environment.removed_environment({ HTTPS_PROXY: 'not a url' })

		expect(Object.keys(removed)).toStrictEqual([...agent_session_environment.PARENT_SESSION_KEYS])
	})

	it('covers each loopback spelling a wrapper may write', () => {
		for (const host of agent_session_environment.LOOPBACK_HOSTS) {
			const removed = agent_session_environment.removed_environment({
				HTTPS_PROXY: `http://${host}:52554`,
			})

			expect(Object.keys(removed)).toContain('HTTPS_PROXY')
		}
	})
})
