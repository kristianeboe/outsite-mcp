# Outsite Availability MCP

An unofficial, read-only MCP server for researching public Outsite locations, quoted stay rates, and individual room calendars.

Repository: [kristianeboe/outsite-mcp](https://github.com/kristianeboe/outsite-mcp)

This project uses Outsite's public website and the same anonymous GraphQL reads used by its booking interface. It does not forward browser cookies, access Outsite accounts, book rooms, or make payments. Outsite has not endorsed this project, and its private GraphQL contract can change without notice.

## Tools

- `find_outsite_locations`: resolve a city, country, neighborhood, or house name to an Outsite slug.
- `search_outsite_stays`: return current room/rate combinations for exact dates. Its optional `member` filter accepts `true` for member-labelled rates, `false` for guest or non-member rates, and can be omitted to compare both.
- `get_outsite_room_calendar`: inspect a specific room type across a wider date window and identify contiguous open periods.

All tools are read-only and include a source URL plus `fetchedAt` timestamp.

## Local development

Requires Node.js 22.22.2 or newer and pnpm.

```bash
pnpm install --ignore-workspace
pnpm dev
```

The MCP endpoint is available at `http://localhost:3000/mcp`. The framework's Inspector is available from the local development server.

## Checks

```bash
pnpm typecheck
pnpm test
RUN_LIVE=1 pnpm test
pnpm build
```

The live test makes anonymous requests to Outsite and confirms location discovery, rate search, and a room calendar.

## Configuration

The defaults are suitable for deployment. Optional environment variables:

- `OUTSITE_GRAPHQL_URL`: defaults to `https://api.outsite.co/graphql`.
- `OUTSITE_CACHE_TTL_MS`: anonymous upstream cache duration, default 300000.
- `OUTSITE_TIMEOUT_MS`: upstream request timeout, default 12000.

## Deployment

Manufact Cloud is the canonical host. The intended public endpoint is:

```text
https://outsite-mcp.kristianeboe.me/mcp
```

Deploy from the connected GitHub repository or run `pnpm deploy`. Re-run the live smoke and MCP Inspector against the production endpoint after each tool-contract change.

DNS for the custom hostname can be managed through Namecheap's official remote MCP at `https://mcp.namecheap.com/mcp`. Read the existing zone first, then add the CNAME target supplied by Manufact and verify that the record persisted.

## Boundaries

- Keep the public surface anonymous and read-only.
- Never accept, store, or forward Outsite session cookies or account tokens.
- Do not add booking, payment, reservation changes, or other mutations.
- Treat returned member-rate labels as public price discovery, not proof of membership entitlement.
- Leave `member` unset when looking for the cheapest quote. Guest, member, and promotional rates can appear in any price order.
- Preserve raw rate totals and timestamps. Do not promise availability.

## Documentation used

- [OpenAI: Build an MCP server](https://developers.openai.com/apps-sdk/build/mcp-server/)
- [OpenAI: Define tools](https://developers.openai.com/apps-sdk/plan/tools/)
- [Manufact TypeScript quickstart](https://docs.mcp-use.com/typescript/getting-started/quickstart)

## License

MIT
