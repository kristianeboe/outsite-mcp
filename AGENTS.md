# Outsite Availability MCP

This repository owns the unofficial Outsite availability adapter, MCP tool schemas, tests, and Manufact deployment.

## Product boundary

- Public, anonymous, read-only research only.
- Never read, accept, store, or forward browser cookies, Outsite account tokens, or payment data.
- Do not add booking, payment, reservation, membership, or profile mutations.
- The upstream GraphQL API is undocumented. Validate response shapes, timestamp results, cache briefly, and fail clearly when the contract drifts.
- A visible member-rate label does not prove that the caller can book that rate.

## Runtime

- Node.js 22.22.2 or newer.
- pnpm with `--ignore-workspace` because the parent portfolio folder has its own unrelated pnpm workspace.
- Manufact Cloud is the canonical deployment target.
- Production endpoint: `https://outsite-mcp.kristianeboe.me/mcp` once DNS is configured.

## Verification

Run `pnpm typecheck`, `pnpm test`, `RUN_LIVE=1 pnpm test`, and `pnpm build` before deployment. After deployment, initialize the production MCP endpoint and call all three tools.
