import { cases } from '#scripts/cases/cases-logic'

// joshuafolkken/kit#2355: the network boundary's abnormal cases were declared and never run. The unit
// suite blocks the network by construction (`test-network-guard.ts` shims the `gh` and `git`
// binaries), so `josh cases`' network vocabulary had no way to be *executed* — only named in a test
// declaration, where the failure mode nobody anticipated is exactly the one that never gets declared
// (the transport failure of joshuafolkken/kit#2317 was hit before it was foreseen).
//
// This makes each of those failure modes injectable as a `fetch` stand-in that produces the failure
// without opening a connection. It does not weaken the guard: the shims are untouched, no real request
// leaves the machine, and the stand-in only shapes the `Response` (or rejection) the caller's error
// path already has to survive. The mode set is single-sourced from `cases`, so the vocabulary the
// command prints and the failures that can be injected cannot drift apart — `INJECTORS` is asserted
// exhaustive against it in the colocated test.

// A `fetch` stand-in: the real signature takes an input and an optional init, both ignored here since
// the failure is fixed by the mode rather than the request.
type FetchStub = (input?: unknown, init?: unknown) => Promise<Response>

const NON_200_STATUS = 500
const RATE_LIMIT_STATUS = 429
const OK_STATUS = 200

// The two rejection failures wear the shapes the platform itself throws, so a caller's `catch` sees
// what a real timeout or dropped connection would produce: `AbortSignal.timeout` rejects with a
// `TimeoutError` DOMException, and a transport failure rejects with a `TypeError`.
const TIMEOUT_MESSAGE = 'The operation timed out.'
const TIMEOUT_NAME = 'TimeoutError'
const CONNECTION_DROP_MESSAGE = 'fetch failed'
// A body that is present but not JSON, told apart from the empty body by having content at all.
const INVALID_JSON_BODY = '{'
const EMPTY_BODY = ''

function ok_body(body: string): FetchStub {
	return async () => new Response(body, { status: OK_STATUS })
}

function non_ok(code: number): FetchStub {
	return async () => new Response(EMPTY_BODY, { status: code })
}

function rejecting(error: Error): FetchStub {
	return async () => {
		throw error
	}
}

// Keyed by the exact vocabulary term `josh cases` prints for the network boundary. The colocated test
// proves this key set equals that vocabulary, so a term added there without an injector here fails.
const INJECTORS: Readonly<Record<string, FetchStub>> = {
	非200: non_ok(NON_200_STATUS),
	タイムアウト: rejecting(new DOMException(TIMEOUT_MESSAGE, TIMEOUT_NAME)),
	接続断: rejecting(new TypeError(CONNECTION_DROP_MESSAGE)),
	空レスポンス: ok_body(EMPTY_BODY),
	不正JSON: ok_body(INVALID_JSON_BODY),
	レート制限: non_ok(RATE_LIMIT_STATUS),
}

// The failure modes that can be injected — the injector key set, for the correspondence assertion.
function supported_modes(): ReadonlyArray<string> {
	return Object.keys(INJECTORS)
}

// A `fetch` stand-in producing the named failure. An unknown mode throws rather than silently passing:
// a typo in a test must not degrade into a request that quietly does nothing.
function faulty_fetch(mode: string): FetchStub {
	const injector = INJECTORS[mode]
	if (injector === undefined) throw new Error(`unknown network failure mode: ${mode}`)

	return injector
}

// The network vocabulary this injector must cover, single-sourced from the command's own definition.
const NETWORK_MODES: ReadonlyArray<string> = cases.cases_for(['network'])

const http_fault_injection = { NETWORK_MODES, faulty_fetch, supported_modes }

export type { FetchStub }
export { http_fault_injection }
