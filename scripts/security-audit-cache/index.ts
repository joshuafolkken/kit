// The public surface a separate machine-wide security checker imports to reuse `josh audit`'s pass
// cache (joshuafolkken/kit#8255). Exported rather than copied so the cache key, lifetime and
// reservation stay single-sourced in kit.
// `reserved_audit` and the default ports scan the project the process started in (its cwd at
// import), not `ports.root`: a caller auditing another root passes its own `audit` and
// `is_trusted`, or a clean scan of the start directory is recorded as a pass for that root.
export { security_audit_cache } from '#scripts/security/security-audit-cache'
export type { AuditPorts } from '#scripts/security/security-audit-cache'
