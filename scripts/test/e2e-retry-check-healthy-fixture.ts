// The wrangler debug log from a run that failed with its preview server healthy the whole time —
// the counter-example joshuafolkken/kit#911 was opened to get, and the one CI cannot hand over.
// `ci.yml` uploads `e2e-web-server-log` only on a job failure, and every game-kit E2E failure still
// on record is a crash, so a suite that merely failed has never produced an artifact.
//
// This one was captured by running game-kit's own suite against the same wrangler preview server
// the CI job uses (`CI=1`, wrangler 4.125.0) with one deliberately failing assertion added: 1
// failed, 36 passed, and not one `net::ERR_CONNECTION_REFUSED`. The server answered every request
// from the first test to the last and was then shut down the way Playwright shuts a `webServer`
// down at the end of every run, failing ones included.
//
// It is quoted **complete**, all 243 lines, so the negative the suite asserts is a property of the
// log rather than of an excerpt — including the ending, which is the decisive part: the log runs to
// its last line on an ordinary heartbeat, with no error of any kind behind the run's final request.
//
// Four values were substituted, each marked in place, and none of them is a line this rule reads:
// the two absolute paths of the machine it was captured on, the loopback handshake value wrangler
// generates per process, and the telemetry id that identifies that machine. Every other character
// is as wrangler wrote it. That is the answer to #911's doubt — a run whose suite failed with the
// server healthy throughout produces neither signature, so the shutdown that ends every such run
// cannot hand a retry to a pull request whose tests failed on their own.
//
// One thing it does carry is the bare `✘ [ERROR]` that joshuafolkken/kit#872 listed as a third
// crash marker: three times, each an ordinary 404. Nothing may be built on that string.
//
// This module is separate from the crash log's so each stays inside the file-length limit, and
// both are `*-fixture.ts`, which `package.json`'s `files` keeps out of the published package.
const OBSERVED_HEALTHY_FAILURE_LOG = `

--- 2026-08-26T19:46:48.686Z debug
🪵  Writing logs to "<capture directory>/wrangler-2026-08-26_19-46-48_536.log"
---

--- 2026-08-26T19:46:48.686Z debug
.env file not found at "<game-kit checkout>/.env.local". Continuing... For more details, refer to https://developers.cloudflare.com/workers/wrangler/system-environment-variables/
---

--- 2026-08-26T19:46:48.694Z log

 ⛅️ wrangler 4.125.0 (update available 4.126.0)
───────────────────────────────────────────────
---

--- 2026-08-26T19:46:48.700Z debug
setting config
---

--- 2026-08-26T19:46:48.700Z debug
Updating config... undefined undefined
---

--- 2026-08-26T19:46:48.703Z debug
Metrics dispatcher: Posting data {"deviceId":"<redacted: wrangler per-machine telemetry id>","event":"wrangler command started","timestamp":1787773608703,"properties":{"amplitude_session_id":1787773608694,"amplitude_event_id":0,"wranglerVersion":"4.125.0","wranglerMajorVersion":4,"wranglerMinorVersion":125,"wranglerPatchVersion":0,"osPlatform":"Mac OS","osVersion":"Darwin Kernel Version 25.6.0: Fri Jul 31 19:16:36 PDT 2026; root:xnu-12377.161.14~5/RELEASE_ARM64_T6030","nodeVersion":25,"packageManager":"pnpm","isFirstUsage":false,"configFileType":"none","isCI":true,"isPagesCI":false,"isWorkersCI":false,"isInteractive":false,"hasAssets":false,"agent":"claude-code","argsUsed":["local","port"],"argsCombination":"local, port","sanitizedCommand":"dev","sanitizedArgs":{"local":true},"currentAgentSkillsInstalled":false}}
---

--- 2026-08-26T19:46:48.742Z debug
local dev variables file not found at ".dev.vars". Continuing... For more details, refer to https://developers.cloudflare.com/workers/wrangler/system-environment-variables/
---

--- 2026-08-26T19:46:48.742Z log
Using secrets defined in .env
---

--- 2026-08-26T19:46:48.742Z debug
.env file not found at "<game-kit checkout>/.env.local". Continuing... For more details, refer to https://developers.cloudflare.com/workers/wrangler/system-environment-variables/
---

--- 2026-08-26T19:46:48.743Z log
Your Worker has access to the following bindings:
---

--- 2026-08-26T19:46:48.743Z log
Binding                                  Resource                  Mode
---

--- 2026-08-26T19:46:48.743Z log
env.ASSETS                               Assets                    local
---

--- 2026-08-26T19:46:48.743Z log
env.TELEGRAM_BOT_TOKEN ("(hidden)")      Environment Variable      local
---

--- 2026-08-26T19:46:48.743Z log
env.TELEGRAM_CHAT_ID ("(hidden)")        Environment Variable      local
---

--- 2026-08-26T19:46:48.743Z log
env.SONAR_TOKEN ("(hidden)")             Environment Variable      local
---

--- 2026-08-26T19:46:48.743Z log
env.JOSH_SESSION_LANG ("(hidden)")       Environment Variable      local
---

--- 2026-08-26T19:46:48.743Z log
env.PORT_SEED ("(hidden)")               Environment Variable      local
---

--- 2026-08-26T19:46:48.743Z log

---

--- 2026-08-26T19:46:48.822Z debug
RemoteRuntimeController teardown beginning...
---

--- 2026-08-26T19:46:48.822Z debug
RemoteRuntimeController teardown complete
---

--- 2026-08-26T19:46:48.823Z log
⎔ Starting local server...
---

--- 2026-08-26T19:46:48.903Z log
Wrangler detected this dev session is running in an AI agent.
The Local Explorer API is available at http://localhost:4177/cdn-cgi/local/explorer/api
Useful routes:
  GET http://localhost:4177/cdn-cgi/local/explorer/api/local/workers - local Workers and bindings
  GET http://localhost:4177/cdn-cgi/local/explorer/api/storage/kv/namespaces - KV namespaces
  GET http://localhost:4177/cdn-cgi/local/explorer/api/d1/database - D1 databases
  GET http://localhost:4177/cdn-cgi/local/explorer/api/r2/buckets - R2 buckets
  GET http://localhost:4177/cdn-cgi/local/explorer/api/workers/durable_objects/namespaces - Durable Object namespaces
  GET http://localhost:4177/cdn-cgi/local/explorer/api/workflows - Workflows
  POST http://localhost:4177/cdn-cgi/local/explorer/api/local/observability/query - run a read-only SQL query (SELECT/WITH only) over captured request traces and console logs. Tables: spans, logs (read attributes via json(attributes)). Example:
    curl -X POST http://localhost:4177/cdn-cgi/local/explorer/api/local/observability/query -H 'Content-Type: application/json' -d '{"sql":"SELECT service, name, outcome, duration_ms FROM spans WHERE parent_id IS NULL LIMIT 20"}'
If the routes above don't cover what you need, fetch the full OpenAPI schema (large - use only as a last resort):
  GET http://localhost:4177/cdn-cgi/local/explorer/api - OpenAPI schema
---

--- 2026-08-26T19:46:48.907Z debug
[InspectorProxyWorker] handleProxyControllerIncomingMessage {"type":"reloadStart"}
---

--- 2026-08-26T19:46:48.942Z debug
[InspectorProxyWorker] handleProxyControllerIncomingMessage {"type":"reloadComplete","proxyData":{"userWorkerUrl":{"protocol":"http:","hostname":"127.0.0.1","port":"50491"},"userWorkerInspectorUrl":{"protocol":"ws:","hostname":"127.0.0.1","port":"50485","pathname":"/core:user:game-kit"},"userWorkerInnerUrlOverrides":{"protocol":"http:","hostname":"game-kit.joshuafolkken.com","port":""},"headers":{"MF-Proxy-Shared-Secret":"<redacted: a per-process loopback value, not read here>"},"liveReload":false,"proxyLogsToController":false}}
---

--- 2026-08-26T19:46:48.942Z debug
[InspectorProxyWorker] reconnectRuntimeWebSocket
---

--- 2026-08-26T19:46:48.942Z debug
[InspectorProxyWorker] NEW RUNTIME WEBSOCKET http://127.0.0.1:50485/core:user:game-kit
---

--- 2026-08-26T19:46:48.943Z debug
[InspectorProxyWorker] SEND TO DEVTOOLS {"method":"Runtime.executionContextsCleared"}
---

--- 2026-08-26T19:46:48.943Z debug
[InspectorProxyWorker] RUNTIME WEBSOCKET OPENED
---

--- 2026-08-26T19:46:48.943Z debug
[InspectorProxyWorker] SEND TO RUNTIME {"method":"Runtime.enable","id":100000001}
---

--- 2026-08-26T19:46:48.944Z debug
[InspectorProxyWorker] RUNTIME INCOMING MESSAGE {
  method: 'Runtime.executionContextCreated',
  params: {
    context: {
      id: 159716961,
      origin: '',
      name: 'Worker',
      uniqueId: '-7103182353538375636.6767330725203295982'
    }
  }
}
---

--- 2026-08-26T19:46:48.944Z debug
[InspectorProxyWorker] RUNTIME INCOMING MESSAGE { id: 100000001, result: {} }
---

--- 2026-08-26T19:46:58.947Z debug
[InspectorProxyWorker] SEND TO RUNTIME {"method":"Runtime.getIsolateId","id":100000002}
---

--- 2026-08-26T19:46:58.948Z debug
[InspectorProxyWorker] RUNTIME INCOMING MESSAGE { id: 100000002, result: { id: 'c1c231d35ce435e7' } }
---

--- 2026-08-26T19:47:08.949Z debug
[InspectorProxyWorker] SEND TO RUNTIME {"method":"Runtime.getIsolateId","id":100000003}
---

--- 2026-08-26T19:47:08.950Z debug
[InspectorProxyWorker] RUNTIME INCOMING MESSAGE { id: 100000003, result: { id: 'c1c231d35ce435e7' } }
---

--- 2026-08-26T19:47:18.954Z debug
[InspectorProxyWorker] SEND TO RUNTIME {"method":"Runtime.getIsolateId","id":100000004}
---

--- 2026-08-26T19:47:18.955Z debug
[InspectorProxyWorker] RUNTIME INCOMING MESSAGE { id: 100000004, result: { id: 'c1c231d35ce435e7' } }
---

--- 2026-08-26T19:47:25.734Z error
✘ [ERROR] 

  [404] GET /@vite/client


---

--- 2026-08-26T19:47:25.735Z debug
[InspectorProxyWorker] RUNTIME INCOMING MESSAGE {
  method: 'Runtime.consoleAPICalled',
  params: {
    type: 'error',
    args: [ [Object] ],
    executionContextId: 159716961,
    timestamp: 1787773645725,
    stackTrace: { callFrames: [Array] }
  }
}
---

--- 2026-08-26T19:47:25.948Z error
✘ [ERROR] 

  [404] GET /@vite/client


---

--- 2026-08-26T19:47:25.949Z debug
[InspectorProxyWorker] RUNTIME INCOMING MESSAGE {
  method: 'Runtime.consoleAPICalled',
  params: {
    type: 'error',
    args: [ [Object] ],
    executionContextId: 159716961,
    timestamp: 1787773645947,
    stackTrace: { callFrames: [Array] }
  }
}
---

--- 2026-08-26T19:47:27.452Z error
✘ [ERROR] 

  [404] GET /@vite/client


---

--- 2026-08-26T19:47:27.453Z debug
[InspectorProxyWorker] RUNTIME INCOMING MESSAGE {
  method: 'Runtime.consoleAPICalled',
  params: {
    type: 'error',
    args: [ [Object] ],
    executionContextId: 159716961,
    timestamp: 1787773647452,
    stackTrace: { callFrames: [Array] }
  }
}
---

--- 2026-08-26T19:47:28.954Z debug
[InspectorProxyWorker] SEND TO RUNTIME {"method":"Runtime.getIsolateId","id":100000005}
---

--- 2026-08-26T19:47:28.955Z debug
[InspectorProxyWorker] RUNTIME INCOMING MESSAGE { id: 100000005, result: { id: 'c1c231d35ce435e7' } }
---
`

export { OBSERVED_HEALTHY_FAILURE_LOG }
