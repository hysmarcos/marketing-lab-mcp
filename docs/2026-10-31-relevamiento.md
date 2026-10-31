# MCP server for marketing analytics: landscape, transport, free hosting, registries

Research date: 2026-10-31. Every claim cites the page it came from; "read 2026-10-31" applies to all pages unless noted. Items marked **(unverified)** could not be confirmed against a primary source.

Constraints being checked: public live demo, no install and no account for the visitor, no credit card anywhere, no paid API (no LLM key), runs unattended for years, fake/public data only.

---

## 1. Existing marketing MCP servers

Stars and last-push dates come from the GitHub API, versions from npm/PyPI JSON APIs, read 2026-10-31. "Probed" means an unauthenticated MCP request was sent to the endpoint on 2026-10-31.

### 1a. Vendor (data-access) servers

All of these need an account of the vendor; none has a public no-login demo. Several vendors also expose a keyless **docs** MCP (searches documentation only).

| Vendor | Official? | Endpoint / package | What it does | Auth | Stars / notes |
|---|---|---|---|---|---|
| Google Analytics (GA4) | Yes, "Experimental" | `pipx run analytics-mcp`, local. https://github.com/googleanalytics/google-analytics-mcp | Admin + Data API: account summaries, `run_report`, `run_funnel_report`, realtime; write (`create_property_annotation`) only with `--allow-write` | Google ADC with `analytics.readonly`; GCP project with APIs enabled | 3.6k stars, 758 forks |
| Google Ads | Yes (googleads org) | https://github.com/googleads/google-ads-mcp ; stdio or Streamable HTTP (Cloud Run / Podman examples) | Tools `search`, `get_resource_metadata`, `list_accessible_customers` + resources | Google Ads API in a GCP project, OAuth/ADC; developer token for production (Explorer access) | 1.1k stars |
| Meta Ads | Yes (Ads AI Connectors, launched 2026-04-29; opened to all developers 2026-07-16) | Remote `https://mcp.facebook.com/ads` + npm CLI. https://developers.facebook.com/documentation/ads-commerce/ads-ai-connectors/ads-mcp-server/ads-mcp-server-overview , https://developers.facebook.com/blog/post/2026/07/16/meta-ads-mcp-server/ | Manage campaigns, insights | Meta Business OAuth | Community alt: Pipeboard meta-ads-mcp |
| HubSpot | Yes, two | Remote `https://mcp.hubspot.com` (https://developers.hubspot.com/mcp); local npm `@hubspot/mcp-server` 0.4.0 via `hs mcp setup` | CRM read/write; dev projects | OAuth user-level app / CLI auth | Repo HubSpot/mcp-server 6 stars, stale (2025-04) |
| Mailchimp | Only Transactional (Mandrill) | `https://mandrillapp.com/mcp` (https://mailchimp.com/developer/transactional/guides/how-to-use-mailchimps-transactional-messaging-mcp/) | 9 tools: send diagnosis, templates | Bearer API key | Keyless docs MCP `https://mailchimp.com/developer/_mcp/server` (probed OK). Community Marketing-API server damientilman/mailchimp-mcp-server, 24 stars, API key |
| Klaviyo | Yes | Remote `https://mcp.klaviyo.com/mcp`; PyPI `klaviyo-mcp-server` 0.4.2 (https://developers.klaviyo.com/en/docs/klaviyo_mcp_server) | Campaigns, flows, profiles, reporting | OAuth (remote, probed 401) / private API key; Owner/Admin/Manager roles | No repo |
| Brevo | Yes | `https://mcp.brevo.com/v1/brevo/mcp` + per-module endpoints (https://developers.brevo.com/docs/mcp-protocol) | Full API by module | Bearer "MCP" token | Keyless docs MCP (probed OK). GA vs early-access unclear |
| Shopify | Yes | Dev MCP npm `@shopify/dev-mcp` 1.18.0, local, **no auth** (https://shopify.dev/docs/apps/build/devmcp; repo Shopify/Shopify-AI-Toolkit 621 stars). Storefront: old `/api/mcp` tools removed, now UCP at `https://{shop}/api/ucp/mcp` (https://shopify.dev/docs/apps/build/storefront-mcp) | Dev: docs/schema search, GraphQL/Liquid validation. Storefront: catalog/cart/checkout per store | Dev: none. UCP: agent profile; checkout signed | — |
| A Latin American e-commerce platform | Yes (Admin MCP) | Hosted admin MCP endpoint | Sales, orders, inventory, products | OAuth (probed 401) | Community servers exist (store token) |
| Similarweb | Yes | `https://mcp.similarweb.com` (https://docs.similarweb.com/api-v5/mcp/mcp-setup) | Traffic intelligence | Login + API/Business/Enterprise plan, data credits | — |
| Semrush | Yes | `https://mcp.semrush.com/v2/mcp` (https://developer.semrush.com/api/basics/semrush-mcp/) | SEO/keyword data | OAuth 2.1 or API key; API-unit plan | — |
| Ahrefs | Yes | `https://api.ahrefs.com/mcp/mcp` (https://docs.ahrefs.com/mcp/docs/introduction) | SEO data | OAuth; paid plans from Lite | Old local repo ahrefs/ahrefs-mcp-server (100 stars) archived |
| GrowthBook | Yes | Remote `https://mcp.growthbook.io/mcp`; npm `@growthbook/mcp` 2.2.0; Docker (https://docs.growthbook.io/integrations/mcp) | Flags, experiments | OAuth / `GB_API_KEY` | growthbook/growthbook-mcp 24 stars; GrowthBook itself is OSS/self-hostable |
| Statsig | Yes | `https://api.statsig.com/v3/mcp` (https://docs.statsig.com/integrations/mcp/manual-setup) | Gates, experiments | OAuth or console key | Keyless docs MCP `https://docs.statsig.com/api/mcp` (probed OK) |
| Amplitude | Yes | `https://mcp.amplitude.com/mcp` (https://amplitude.com/docs/amplitude-ai/amplitude-mcp) | Charts, analysis | OAuth; **not on Free plan** | Keyless docs MCP (probed OK) |
| Mixpanel | Yes | `https://mcp.mixpanel.com/mcp` (https://docs.mixpanel.com/docs/mcp) | Analytics queries | OAuth / service accounts; on by default for Free/Growth accounts created after 2026-08-01 | — |
| PostHog | Yes | `https://mcp.posthog.com/mcp` (https://posthog.com/docs/model-context-protocol) | Product analytics, flags, experiments | Login / personal API key (probed 401) | Source in PostHog/posthog monorepo; old PostHog/mcp (151 stars) archived |
| Optimizely | Yes (2026-04-29) | Overview: https://docs.optimizely.com/experimentation-strategy/docs/optimizely-experimentation-mcp-server-overview (endpoint URL **unverified**) | Experimentation | Opti ID OAuth + Opal | — |
| LaunchDarkly | Yes | Hosted `https://mcp.launchdarkly.com/mcp/launchdarkly`; npm `@launchdarkly/mcp-server` 0.7.2 (https://launchdarkly.com/docs/home/getting-started/mcp) | Flags | API key (local); hosted auth likely OAuth (**unverified**) | launchdarkly/mcp-server 27 stars |

### 1b. MMM / budget servers

| Server | What it is | Account / key | Demo |
|---|---|---|---|
| `mcp-server-meridian` (PyPI 0.2.6, BlueAlpha, MIT) https://pypi.org/project/mcp-server-meridian/ | Loads a pickled, already-fitted Google Meridian model; 12 tools: ROI, mROI, saturation, adstock, contributions, budget reallocation | None (local stdio) | No |
| `bluealpha-mmm-builder-mcp` (PyPI 0.1.3) https://pypi.org/project/bluealpha-mmm-builder-mcp/ | 24 tools: readiness, sample data, priors from beliefs, local Meridian fit, export to BlueAlpha (upsell) | None for local use | No |
| google-meridian-mcp (muhammad1azmi, 1 star, Glama https://glama.ai/mcp/servers/off1uzkp67) | Guidance, lift-test-to-prior calculator, spec auditor, code generator; does not fit | None | Listed SSE endpoint did not respond |
| PyMC Marketing MCP (imMamdouhaboammar/pymc-marketing-mcp, 2 stars, https://glama.ai/mcp/servers/uk42itw8la) | 33 tools: fit/diagnose MMM, budget optimisation behind diagnostics gate, CLV | None for stdio | No; beta |
| `simba-mcp` (PyPI 0.18.0) https://pypi.org/project/simba-mcp/ | Thin client for paid Simba SaaS | `SIMBA_API_KEY`; demo endpoint returned 401 | No |
| `mixlift` (PyPI 0.5.3) https://pypi.org/project/mixlift/ | CSV in, ROAS/saturation/reallocation out; built-in demo dataset | Commercial tiers (Growth $299/mo); enforcement unclear; repo 404 | No |
| matheusfrote/mmm-intelligence-mcp (1 star, Apache-2.0) | 45 tools: Ridge + adstock/Hill MMM, scenarios, synthetic data | None | Local dashboard only (127.0.0.1) |
| Robyn | **No Robyn MCP found** | — | — |

### 1c. Keyless "marketing math" servers (closest to the proposed project)

| Server | Computes | Keys | Live / browser demo |
|---|---|---|---|
| **aaj-engines** (sarojkjha/aaj-marketing-skills, 1 star, MIT, 279 commits) https://github.com/sarojkjha/aaj-marketing-skills | 66 dependency-free Node "engines" behind 5 generic tools (`list_engines`, `describe_engine`, `run_engine`, `search_skills`, `get_skill`): A/B significance, paid-media budget allocation with diminishing returns, unit economics LTV/CAC/payback, incrementality, churn/NRR, pricing | None | **Hosted no-login MCP on Cloudflare Workers** `https://aaj-engines-mcp.sarojkjha10.workers.dev/mcp` (probed OK); in official registry as `io.github.sarojkjha/aaj-engines`. No in-browser MCP playground (separate web calculators on aajconsult.com) |
| `abtestresult-mcp` (npm 1.3.1) https://abtestresult.com/mcp-server | z-test, Welch t, sample size, MDE, Bayesian A/B (P(best), expected loss), SRM, paired test, survey sizing | "No API keys" | Web calculators, no MCP playground; no public repo, license not open |
| `rigor-mcp` (PyPI 0.5.0, mrnh/rigor, 1 star, MIT) | Hypothesis tests, power, multiple comparisons, always-valid sequential testing, peeking inflation | None | No |
| ABharadwaj-cell/marketing-ops-mcp (0 stars, MIT) | Funnel metrics, attribution reconciliation, sample size, experiment analysis with SRM gate, **UTM builder** | None (OpenAI key only for optional agent mode) | No |
| thaolst/growth-mcp (PyPI `growth-mcp`, 10 stars) | A/B analysis, sample size, retention cohorts | None (BigQuery/Mixpanel optional) | Local Streamlit only |
| princeruhulofficial/mcp-saas-metrics (0 stars) | LTV, CAC, runway | None | No |
| retentioneering-tools (943 stars) | Clickstream funnels/cohorts; MCP server in beta | None | No |
| `@gongrzhe/server-ab-test-calculator` (npm) | Two-proportion z-test, CIs, sample size | None | No |
| Attribution (Markov / Shapley) | **No maintained MCP server found.** Libraries exist without MCP wrappers: dp6/marketing-attribution-models (373 stars), eeghor/mta (132 stars) | — | — |
| Email benchmarks | **No keyless MCP server found** (Vinkius "Email Performance MCP" is hosted SaaS, page 404) | — | — |

### 1d. The gap

- Vendor servers (GA4, Ads, Meta, HubSpot, Klaviyo, e-commerce platforms...) are **data pipes**: they need the visitor's account, so none can be demoed publicly. That space is saturated by the vendors themselves.
- Keyless math servers exist but are **thin and fragmented**: mostly A/B statistics, 0–10 stars, stdio-only, no transparent statistical documentation, no tests published, no visual playground. The single exception, aaj-engines, already proves the "hosted keyless MCP on Workers" pattern, but hides its 66 engines behind a generic `run_engine` tool (weak tool schemas for LLMs) and has no browser MCP playground.
- **Nobody combines**: (1) Markov + Shapley multi-touch attribution, (2) adstock + Hill saturation response curves with budget optimisation (closed form / greedy marginal-ROI, cheap enough for 10 ms CPU), (3) Bayesian + frequentist A/B with sample size and SRM, (4) RFM / cohort retention / LTV, (5) curated email benchmarks with cited sources, as **typed, individually documented MCP tools**, with a **no-install browser playground** that runs the same server code in-page and a **public stateless remote URL** that free Claude users can add as their one custom connector.
- MMM *fitting* (Meridian / PyMC) is covered locally by several Python servers but cannot run on a free edge host; the defensible niche is MMM *decisions* (response curves, marginal ROI, reallocation) from given or calibrated parameters, which matches this repo's existing model.

---

## 2. Transport and protocol status

### Spec version
- Latest spec revision: **2026-07-28** (previous: 2025-11-25). Source: https://modelcontextprotocol.io/specification/2026-07-28/changelog
- Biggest change: MCP is now **stateless**. The `initialize` handshake and the `Mcp-Session-Id` header are removed; each request carries protocol version and client capabilities in `_meta`. Servers MUST implement a new `server/discover` RPC. SSE resumability (`Last-Event-ID`) is removed. Streamable HTTP POSTs must carry `Mcp-Method` / `Mcp-Name` headers. List results (`tools/list` etc.) require `ttlMs` and `cacheScope`. Same source.
- Deprecated in 2026-07-28: the old **HTTP+SSE transport** (deprecated since 2025-03-26, now formally "Deprecated" under the lifecycle policy, min. 12-month window), Roots, Sampling, Logging, and OAuth Dynamic Client Registration (in favor of Client ID Metadata Documents). Same source.
- Standard transports are exactly two: **stdio** and **Streamable HTTP** (each message an HTTP POST to one endpoint; reply is JSON or a request-scoped SSE stream). Custom transports are allowed if they keep JSON-RPC and the per-request metadata model. Source: https://modelcontextprotocol.io/specification/2026-07-28/basic/transports
- Backward compatibility: clients/servers detect the counterpart's era and fall back to the initialize-based flow. Same source (Backward Compatibility section).

### Official TypeScript SDK
- **v2 is the stable line**, on `main`, implementing spec 2026-07-28. Packages split into `@modelcontextprotocol/server` and `@modelcontextprotocol/client`, with optional `@modelcontextprotocol/node`, `/express`, `/fastify`, `/hono`. v1 (`@modelcontextprotocol/sdk`) lives on the `v1.x` branch with bug/security fixes for at least 6 months after v2. Source: https://github.com/modelcontextprotocol/typescript-sdk
- npm `latest` (read 2026-10-31): `@modelcontextprotocol/server` **2.4.0** (deps: `zod ^4.2.0`, `@modelcontextprotocol/core 2.4.0`), https://registry.npmjs.org/@modelcontextprotocol/server/latest ; legacy `@modelcontextprotocol/sdk` **1.32.2**, https://registry.npmjs.org/@modelcontextprotocol/sdk/latest
- **Web-standard handler built into the SDK**: `createMcpHandler(factory)` from `@modelcontextprotocol/server` returns a `{ fetch }` object usable as the default export on Cloudflare Workers, Deno and Bun. "The factory runs once per request, so a fresh McpServer serves every call." It does no Host/Origin checks; wrap with `hostHeaderValidationResponse` / `originValidationResponse`. Source: https://ts.sdk.modelcontextprotocol.io/v2/serving/web-standard.html
- `InMemoryTransport` ships in `@modelcontextprotocol/client` (`InMemoryTransport.createLinkedPair()`). No official postMessage / Web Worker transport is documented; you implement the `Transport` interface (`start`, `send`, `close`, `onmessage`, `onerror`, `onclose`). Source: https://ts.sdk.modelcontextprotocol.io/v2/advanced/custom-transports.html

### Cloudflare Workers
- Cloudflare's current recommended API is **`createMcpHandler` from `agents/mcp/server`** (install `agents`, `@modelcontextprotocol/server`, `zod`). It "builds a fresh server for every request"; you "do not need a Durable Object, protocol session, or WebSocket". In legacy-compat mode GET/DELETE return 405; `legacy: "reject"` makes a stateless-only endpoint. Page updated 2026-10-27. Source: https://developers.cloudflare.com/agents/api-reference/mcp-handler-api/
- **`McpAgent` is deprecated** (Durable-Object-based, session-ful); Cloudflare points to a migration guide for MCP SDK v2. `createMcpHandler` "serves Streamable HTTP only"; SSE is deprecated. Source: https://developers.cloudflare.com/agents/model-context-protocol/transport/ (updated 2026-10-27)
- Answer: **a stateless Streamable HTTP server does NOT need Durable Objects.** DOs/KV/D1/R2 are only for data you choose to persist.

### Can visitors connect from Claude for free?
- Custom connectors (remote MCP) are available on **Free**, Pro, Max, Ultra, Team, Enterprise, in Claude (web), Cowork and Claude Desktop. **Free users are limited to one custom connector.** "No sign in" (authless) servers are supported. Connections originate from Anthropic's cloud, so the server must be publicly reachable. Sources: https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp and https://claude.com/docs/connectors/custom/remote-mcp
- So a free claude.ai user can paste your Worker URL and use your tools; the LLM cost is on their side, not yours.

### Inspecting / talking to an MCP server from a browser
- **MCP Inspector** (official, 11.2k stars): `npx @modelcontextprotocol/inspector` (web UI = Vite/React SPA + Node backend), also `--cli` / `--tui`. No official hosted version. Source: https://github.com/modelcontextprotocol/inspector
- **Hosted, no-install inspectors** (third party): MCPJam web app at https://app.mcpjam.com (HTTPS URLs only, no stdio; 2.3k stars; login requirement not stated) — https://github.com/MCPJam/inspector ; mcp-use hosted inspector (https://inspector.mcp-use.com, vendor claim, **unverified**).
- **Cloudflare Workers AI Playground** (https://playground.ai.cloudflare.com/): has a "Custom MCP → Add server" panel; you paste a URL and the playground's own Workers AI model (e.g. `@cf/zai-org/glm-4.7-flash`) calls your tools. When I opened it on 2026-10-31 the chat UI and Custom MCP panel loaded with no sign-in prompt (I did not send a message, so rate limits/login on send are **unverified**). Cloudflare's guide: https://developers.cloudflare.com/agents/model-context-protocol/guides/test-remote-mcp-server/ (updated 2026-10-22). This is the closest thing to "chat with my MCP server, zero keys, zero cost to me", but it is a third-party service you don't control.
- **Browser-only (no server at all)**: since the SDK ships `InMemoryTransport` and the server package runs on web-standard runtimes, the same `McpServer` factory can run inside a static page (or a Web Worker via a small custom `Transport` over `postMessage`) and be driven by an in-page `Client`. Community examples: `cmcp` WorkerTransport (https://jsr.io/@mcpc/cmcp/doc), `@mcp-fe/mcp-worker`; SDK feature request for a MessageChannel transport: https://github.com/modelcontextprotocol/typescript-sdk/issues/219 . This is the most robust "works forever" demo: a static playground on GitHub Pages that lists tools, shows JSON schemas, lets the visitor fill inputs and see the raw JSON-RPC request/response, with no backend.

---

## 3. Free hosting without a credit card (late 2026)

| Host | Free limits (primary source) | Card? | Sleep / deletion risk | Fit |
|---|---|---|---|---|
| **Cloudflare Workers Free** | 100,000 requests/day (reset 00:00 UTC; over limit = Error 1027), **10 ms CPU per HTTP request**, 128 MB memory, 64 MiB uncompressed script, 50 subrequests. https://developers.cloudflare.com/workers/platform/limits/ (updated 2026-10-29); https://developers.cloudflare.com/workers/platform/pricing/ (updated 2026-10-02) | Pricing doc: "By default, users have access to the Workers Free plan". Long-standing community/staff answer: no payment method needed for free plans except Zero Trust (https://community.cloudflare.com/t/can-we-be-billed-with-the-free-plan/496803). No current first-party sentence found on 2026-10-31 → treat as very likely but **verify at signup**. | No cold-sleep, no inactivity deletion documented. Over-quota requests fail until reset; no surprise bill on Free. | **Best.** Stateless `createMcpHandler`. Watch the 10 ms CPU cap: closed-form stats are fine; MCMC/large optimization is not. |
| Durable Objects (Free) | Available on Free **only with SQLite backend**: 100k req/day, 13,000 GB-s/day, 5M rows read/day, 100k rows written/day, 5 GB. https://developers.cloudflare.com/durable-objects/platform/pricing/ (updated 2026-10-18) | same | — | Not needed for a stateless server. |
| Workers KV (Free) | 100k reads/day, 1k writes/day, 1 GB. Workers pricing page above. | same | — | Optional (e.g., cached demo data). |
| **GitHub Pages** | Static only. Site ≤ 1 GB, soft 100 GB/month bandwidth, soft 10 builds/hour (not applied when deploying via Actions). Not for commercial SaaS. https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits ; static-only: https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages | No | None for a public repo. | **Best for the browser playground.** The author already deploys marketing-mix-model to Pages via CI. |
| Deno Deploy (new) | Free: 1M requests/month, 10 h active CPU/month, 20 GiB egress, 10 active apps, 1 GiB KV. https://deno.com/deploy/pricing | Not stated (**unverified**) | **Deploy Classic was shut down 2026-07-20**; Classic apps had to be recreated manually (https://docs.deno.com/deploy/migration_guide/). Limits page still says "no uptime guarantees ... during the initial public beta" (https://docs.deno.com/deploy/pricing_and_limits/). | OK technically, but the 2026 platform migration is exactly the "breaks in 3 years" risk. |
| Vercel Hobby | 1M function invocations, 4 active-CPU hours, 360 GB-h memory, 1M CDN requests, 100 GB transfer per month; max duration 300 s. Over limit: wait 30 days. **Non-commercial only.** https://vercel.com/docs/plans/hobby (updated 2026-09-14) | No card for Hobby (upgrade asks for card) | Pausing when limits hit. | Works, but monthly CPU cap + 30-day lockout is worse than Cloudflare's daily reset. |
| Netlify Free | **300 credits/month, hard limit**, never charged. 10k web requests = 2 credits, 1 GB bandwidth = 20, function compute 1 GB-h = 10, **each production deploy = 15 credits**. https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/credit-based-pricing-plans/ (updated 2026-10-30) | Not stated | Projects pause when credits run out. | Weak: ~20 deploys/month eat the whole budget. |
| Render Free | Web services spin down after **15 min idle**, ~1 min cold start; 750 instance-hours/month; free Postgres **deleted 30 days + 14 days grace**. https://render.com/docs/free | Not required for free instances per page | Cold starts; DB deletion. | Poor for an MCP endpoint (clients time out on 1-minute wake). |
| Hugging Face Spaces | **Gradio and Docker Spaces now require a paid plan (PRO) to create**; Static Spaces are free for everyone; free personal accounts can still host up to 2 ZeroGPU Gradio Spaces. CPU Basic sleeps after 48 h idle. https://huggingface.co/docs/hub/spaces-overview , https://huggingface.co/docs/hub/spaces-gpus | — | Sleep after 48 h. | Not viable for a free server; static Space is just another static host. |
| Val Town Free | 100,000 runs/day, 1 min wall time per run, unlimited public vals. https://www.val.town/pricing | Not stated (**unverified**) | Not stated | Possible, but small vendor; long-term risk. |

**Safest "works forever, no card, no inactivity deletion":** GitHub Pages for the static playground (zero runtime, zero quota worry) + Cloudflare Workers Free for the public Streamable HTTP endpoint (stateless, no DOs, no KV needed, no secrets, no cron). Neither has a documented inactivity-deletion policy; the only maintenance risk is SDK/spec drift, which a pinned dependency + the spec's 12-month deprecation window mitigate.

---

## 4. Registries / directories

| Registry | Cost | What you need | Source |
|---|---|---|---|
| **Official MCP Registry** (registry.modelcontextprotocol.io) | Free | Still **in preview** (possible resets). Publish a `server.json` with `mcp-publisher`. Name namespace: `io.github.<user>/<name>` via GitHub OAuth login, or reverse-DNS via DNS TXT / `/.well-known/mcp-registry-auth`. Packages: npm (verify via `mcpName` in package.json), PyPI (`mcp-name:` in README), NuGet, Cargo, OCI, MCPB. **Remote-only servers are allowed** via `remotes: [{type: "streamable-http", url}]`; the URL must be publicly accessible. Docs example combines an `io.github.*` name with a remote on another domain. Not meant for host apps directly; aggregators pull from it. | https://modelcontextprotocol.io/registry/about , https://modelcontextprotocol.io/registry/package-types , https://modelcontextprotocol.io/registry/remote-servers , https://modelcontextprotocol.io/registry/authentication |
| **Smithery** | Not stated | Home page banner (read 2026-10-31): "Smithery's MCP Proxy and managed identity shut down on October 31" (https://smithery.ai/), so check the current flow before relying on its gateway. Publish docs list two paths: (1) URL: give a public HTTPS Streamable HTTP URL at smithery.ai/new, Smithery Gateway proxies and scans tools (or serve `/.well-known/mcp/server-card.json`); (2) local MCPB bundle. No Smithery-hosted free option documented. | https://smithery.ai/docs/build/publish |
| **Glama** | Not stated | "Add Server" button; 113,352 servers listed on 2026-10-31; grades for license/quality/maintenance. Listing rules not documented on the page. | https://glama.ai/mcp/servers |
| **mcp.so** | Not stated | Submit form at mcp.so/submit (repo or server URL), "Listings go live after review". | https://mcp.so/ |

Recommendation: publish an npm package (stdio + library) **and** a `remotes` entry pointing to the Worker URL under `io.github.<user>/...`; then Smithery (URL), Glama and mcp.so pick it up or accept a submit.

---

## 5. Conclusions

1. **Gap to fill:** a keyless, typed "marketing decision math" MCP server (attribution Markov/Shapley, adstock+Hill response curves and budget allocation, A/B frequentist+Bayesian+sample size+SRM, RFM/cohort/LTV, cited email benchmarks) with a browser playground. Closest prior art: aaj-engines (hosted keyless on Workers, generic `run_engine` tool, no MCP playground) and abtestresult-mcp (A/B only, closed source). Markov/Shapley attribution and email benchmarks have no MCP server at all.
2. **Transport:** implement once as a pure TypeScript `McpServer` factory on SDK v2 (`@modelcontextprotocol/server` 2.x, spec 2026-07-28). Ship (a) stdio via npm for Claude Desktop/Code, (b) **stateless Streamable HTTP** via `createMcpHandler` on Cloudflare Workers (no Durable Objects, no SSE), (c) the same factory over `InMemoryTransport` inside a static page for the no-install playground.
3. **Host:** GitHub Pages (playground; already used by marketing-mix-model) + Cloudflare Workers Free (remote URL). Keep every tool closed-form or cheap iterative so it fits 10 ms CPU; keep data as bundled JSON (no KV/DB, nothing to expire). No secrets anywhere.
4. **Visitors without install:** (a) the static playground (form-driven tool calls, raw JSON-RPC view), (b) free claude.ai users add the Worker URL as their one custom connector with "No sign-in", (c) Cloudflare's Workers AI Playground "Custom MCP" lets anyone chat with the tools using Cloudflare's model at no cost to you (third-party, may change).
5. **Registries:** official MCP Registry (preview) with `io.github.<user>/<name>`, npm package (`mcpName`) + `remotes` Worker URL; then Glama and mcp.so submit forms.

### Caveats
- Cloudflare "no card for Workers Free" rests on default-plan docs and a staff community answer; no current first-party sentence found. Verify at signup.
- 10 ms CPU per request on Workers Free: no MCMC, no big Shapley over many channels (Shapley is O(2^n); cap channels around 10–12 or use sampling).
- Spec 2026-07-28 is new; some clients still speak the 2025-era initialize flow. Use SDK v2 which handles back-compat, and test with MCP Inspector and claude.ai.
- Official MCP Registry is in preview; data resets possible.
- A public authless endpoint can be abused; over-quota just returns errors until 00:00 UTC (no bill on Free). Consider Cloudflare's free rate-limiting rules or a per-IP limit.
- Deno Deploy Classic shutdown (2026-07-20) and Hugging Face's paid requirement for Gradio/Docker Spaces show free tiers change; prefer hosts where the demo degrades to static (GitHub Pages) if the server host disappears.
