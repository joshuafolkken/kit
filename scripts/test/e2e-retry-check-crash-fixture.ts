// The wrangler debug log from a preview server that genuinely died, quoted from game-kit run
// 32717058201 attempt 1 (https://github.com/joshuafolkken/game-kit/actions/runs/32717058201). It is
// not a specimen picked to fit: every `e2e-web-server-log` artifact game-kit still retains — 8 of
// them across 6 runs — is from a server that died, each job log showing the wall of
// `net::ERR_CONNECTION_REFUSED` that follows, and the signature matches all 8.
//
// The server had been up for eight seconds when it went; the log ends where the process did. Both
// signatures sit inside one error record, which is why `read_directory_texts` may take its verdict
// per file rather than over the concatenation. The middle of the report is elided at the marked
// line only — wrangler dumps its whole resolved config there and none of those 480 lines is read
// by this rule. Nothing was removed from either quoted region.
//
// The counter-example lives in `./e2e-retry-check-healthy-fixture`, kept separate so each file
// stays inside the length limit.
const OBSERVED_CRASH_LOG = `

--- 2026-08-24T10:31:10.441Z debug
[InspectorProxyWorker] SEND TO RUNTIME {"method":"Runtime.enable","id":100000001}
---

--- 2026-08-24T10:31:10.442Z debug
[InspectorProxyWorker] RUNTIME INCOMING MESSAGE { id: 100000001, result: {} }
---

--- 2026-08-24T10:31:17.611Z debug
Error in ProxyController: Error inside ProxyWorker
 Error
    at castErrorCause (/__w/game-kit/game-kit/node_modules/.pnpm/wrangler@4.125.0/node_modules/wrangler/wrangler-dist/cli.js:180295:20)
    at ProxyController2.emitErrorEvent (/__w/game-kit/game-kit/node_modules/.pnpm/wrangler@4.125.0/node_modules/wrangler/wrangler-dist/cli.js:326367:20)
    at ProxyController2.onProxyWorkerMessage (/__w/game-kit/game-kit/node_modules/.pnpm/wrangler@4.125.0/node_modules/wrangler/wrangler-dist/cli.js:326244:18)
    at PROXY_CONTROLLER (/__w/game-kit/game-kit/node_modules/.pnpm/wrangler@4.125.0/node_modules/wrangler/wrangler-dist/cli.js:325971:24)
    at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
    at async #handleLoopbackCustomFetchService (/__w/game-kit/game-kit/node_modules/.pnpm/miniflare@5.20260820.0-alpha/node_modules/miniflare/dist/src/index.js:111715:22)
    at async #handleLoopback (/__w/game-kit/game-kit/node_modules/.pnpm/miniflare@5.20260820.0-alpha/node_modules/miniflare/dist/src/index.js:112048:20) {
  cause: {
    name: 'Error',
    message: 'Network connection lost.',
    stack: 'Error: Network connection lost.'
  }
}
---

--- 2026-08-24T10:31:17.624Z debug
(… 480 lines of "=> Error contextual data" elided …)
--- 2026-08-24T10:31:17.631Z log

---

--- 2026-08-24T10:31:17.635Z error
✘ [ERROR] 


---

--- 2026-08-24T10:31:17.635Z debug
Error
    at castErrorCause (/__w/game-kit/game-kit/node_modules/.pnpm/wrangler@4.125.0/node_modules/wrangler/wrangler-dist/cli.js:180295:20)
    at ProxyController2.emitErrorEvent (/__w/game-kit/game-kit/node_modules/.pnpm/wrangler@4.125.0/node_modules/wrangler/wrangler-dist/cli.js:326367:20)
    at ProxyController2.onProxyWorkerMessage (/__w/game-kit/game-kit/node_modules/.pnpm/wrangler@4.125.0/node_modules/wrangler/wrangler-dist/cli.js:326244:18)
    at PROXY_CONTROLLER (/__w/game-kit/game-kit/node_modules/.pnpm/wrangler@4.125.0/node_modules/wrangler/wrangler-dist/cli.js:325971:24)
    at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
    at async #handleLoopbackCustomFetchService (/__w/game-kit/game-kit/node_modules/.pnpm/miniflare@5.20260820.0-alpha/node_modules/miniflare/dist/src/index.js:111715:22)
    at async #handleLoopback (/__w/game-kit/game-kit/node_modules/.pnpm/miniflare@5.20260820.0-alpha/node_modules/miniflare/dist/src/index.js:112048:20)
---
`

export { OBSERVED_CRASH_LOG }
