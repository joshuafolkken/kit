// The environment variables that name the **parent** agent session, and which a child session must
// not inherit.
//
// It lived inside `scripts/eval/eval-session.ts` until `josh run:wake` became a second launcher of a
// headless session (joshuafolkken/kit#1719). Two copies of this list is the clone `CLAUDE.md`
// prohibits, and this is the shape of clone that fails silently: the copy that drifts does not throw
// or lint — the child dials the parent's private socket, is refused, and the session dies as
// `API Error: Unable to connect to API (ConnectionRefused)` with nothing anywhere naming the cause.
//
// `CLAUDE_CODE_MESSAGING_SOCKET` is a UNIX socket only the parent listens on,
// `CLAUDE_CODE_MESSAGING_TOKEN` is that socket's credential, and the two session identifiers claim
// the parent's session as the child's own. Measured under joshuafolkken/kit#1158: removing them
// restored 5/5 held in 54 seconds, and lowering the concurrency — the suspected cause before this one
// was found — made it worse.
const PARENT_SESSION_KEYS: ReadonlyArray<string> = [
	'CLAUDE_CODE_MESSAGING_SOCKET',
	'CLAUDE_CODE_MESSAGING_TOKEN',
	'CLAUDE_CODE_SESSION_ID',
	'CLAUDE_CODE_CHILD_SESSION',
]

// **The second thing a child must not inherit is a proxy that belongs to the invocation which
// launched it** (joshuafolkken/kit#1760). `pnpm josh run:wake --start` runs under whatever wraps this
// machine's package manager — here a supply-chain scanner, which stands a proxy up on a loopback port
// and writes `HTTPS_PROXY=http://localhost:<ephemeral>` plus its own CA into the environment of
// everything that invocation spawns. The supervisor is **detached**, so it outlives that proxy and
// hands the dead address to every session it wakes. The agent CLI obeys it, finds nothing listening,
// and dies with the very same `ConnectionRefused` the paragraph above describes — measured at 2 m 57 s
// per wake, three wakes per cut, and a backlog that stops at its first session cut.
//
// **`eval-session.ts` gets the same treatment, and that is deliberate rather than collateral.** Only a
// detached launcher outlives the proxy, so that suite was never the one failing; but neither launcher
// starts a package install, and a scanning proxy that exists to inspect package downloads has no
// business carrying an agent session's API traffic. Making the removal conditional on the call site
// would split one helper into two rules to keep in step, and leave the eval suite the one place a
// dead address can still be inherited.
//
// **Every spelling goes, because the one left behind is the one obeyed.** Clients disagree about
// which variable wins — `ALL_PROXY` is honoured by curl and by several Node agents, the lowercase
// forms by most of the rest — so removing a subset leaves the failure exactly where it was.
const PROXY_KEYS: ReadonlyArray<string> = [
	'ALL_PROXY',
	'HTTP_PROXY',
	'HTTPS_PROXY',
	'all_proxy',
	'http_proxy',
	'https_proxy',
	'GLOBAL_AGENT_HTTP_PROXY',
	'GLOBAL_AGENT_HTTPS_PROXY',
]

// The CA certificate exists to make that interception verifiable, so it goes only when **every** proxy
// the environment declares is going with it. Left alone it may be a person's corporate trust store;
// removed while one of their proxies survives, it takes that proxy's TLS down with it — which is the
// worse of the two mistakes, since the session then reaches nothing at all.
const PROXY_CERTIFICATE_KEY = 'NODE_EXTRA_CA_CERTS'

// **Loopback is the test, and it is what keeps a real proxy untouched.** A proxy on this machine's own
// interface was stood up by some process here, so a launcher that outlives its own parent cannot
// assume the port is still that proxy's; one naming a real host is somebody's network and is left
// exactly as it was. Deciding instead by "did a package manager set it" would need a wrapper
// inventory nobody can keep current.
//
// **The spellings are what `URL` reports, not what a wrapper typed**: `::1` without its brackets is
// not a URL host at all, and `http://[::1]:52554` parses with the brackets kept — so listing the bare
// form beside it would be a row nothing can ever match. The whole of `127.0.0.0/8` is loopback, not
// just `127.0.0.1`, so that half is a prefix rather than a literal.
const LOOPBACK_HOSTS: ReadonlyArray<string> = ['localhost', 'ip6-localhost', '[::1]']
const LOOPBACK_PREFIX = '127.'
const NO_HOST = ''

type EnvironmentSource = Readonly<Record<string, string | undefined>>

function parsed_host(value: string): string {
	try {
		return new URL(value).hostname
	} catch {
		return NO_HOST
	}
}

// **A value with no scheme is read again with one assumed.** `HTTPS_PROXY=localhost:52554` is what
// curl and npm both accept, and `new URL` reads it as the `localhost:` scheme with no host at all —
// so a single parse would hand exactly that dead address on as "not a loopback proxy".
function proxy_host(value: string): string {
	const direct = parsed_host(value)

	return direct === NO_HOST ? parsed_host(`http://${value}`) : direct
}

function is_loopback_host(host: string): boolean {
	return host.startsWith(LOOPBACK_PREFIX) || LOOPBACK_HOSTS.includes(host)
}

function is_loopback_proxy(value: string | undefined): boolean {
	if (value === undefined || value === NO_HOST) return false

	return is_loopback_host(proxy_host(value))
}

function is_declared(value: string | undefined): boolean {
	return value !== undefined && value !== NO_HOST
}

// The certificate joins only when the environment declares no proxy this leaves standing. A machine
// whose wrapper wrote one loopback proxy beside the person's own corporate one keeps both the
// corporate proxy and the trust store that makes it usable.
function loopback_proxy_keys(source: EnvironmentSource): ReadonlyArray<string> {
	const declared = PROXY_KEYS.filter((key) => is_declared(source[key]))
	const matched = declared.filter((key) => is_loopback_proxy(source[key]))
	const is_certificate_included = matched.length > 0 && matched.length === declared.length

	return is_certificate_included ? [...matched, PROXY_CERTIFICATE_KEY] : matched
}

// **`undefined` rather than `''`**, because an empty socket path is still a socket path to whatever
// reads it. Node's spawn omits an environment key whose value is `undefined`, which is the only way
// to hand the child an environment that does not have the variable at all — and both callers spread
// this over an inherited environment, so anything less than absent leaves the variable set.
function removed_environment(source: EnvironmentSource = process.env): Record<string, undefined> {
	const keys = [...PARENT_SESSION_KEYS, ...loopback_proxy_keys(source)]

	return Object.fromEntries(keys.map((key) => [key, undefined]))
}

const agent_session_environment = {
	LOOPBACK_HOSTS,
	PARENT_SESSION_KEYS,
	PROXY_CERTIFICATE_KEY,
	PROXY_KEYS,
	removed_environment,
}

export { agent_session_environment }
