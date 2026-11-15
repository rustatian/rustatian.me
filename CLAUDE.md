# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Personal portfolio site for rustatian.me. Statically prerendered Preact frontend served from S3 and CloudFront. The GitHub data is static JSON that `ghdata/` writes into the build at deploy time. There is no blog and no CMS — all page content is hardcoded in `src/data/profile.ts`.

## Commands

Bun-first: `bun.lock` is the committed lockfile and CI runs Bun. Use `bun run <script>`, never npm. See `package.json` for the full list; the ones that aren't guessable:

- `bun run dev` is the Vite server on **:5173**. It has no GitHub data, so its `/api/*` requests return 404.
- `bun run check` (typecheck + lint + test + prod build) is the gate CI enforces — run it before calling work done.
- `ghdata/` is a Go module (standard library only) that writes the GitHub data files into the build: `GITHUB_TOKEN=$(gh auth token) go run . ../dist` in `ghdata/`, after `bun run build:prod`. Its tests run with `go test ./...` in `ghdata/`, and CI runs them too.

Lint and format are **Biome**. There is no ESLint or Prettier despite what muscle memory suggests.

## Architecture

Production is static. `.github/workflows/deploy.yml` builds `dist/`, runs `ghdata` to write the GitHub data into `dist/api`, and uploads `dist/` to S3. CloudFront serves it with the security headers and the CSP of `HeadersPolicy` in `infra/template.yaml`. The deploy gives `ghdata` the workflow's `GITHUB_TOKEN`. Locally it comes from `gh auth token`.

Load-bearing constraints, none of which the code will teach you on its own:

- **`ghdata` must project each GitHub answer** (`projectUser` and `projectContributions` in `ghdata/main.go`). Its requests carry the site's token, so a body written verbatim publishes fields GitHub only sends to the account owner. Do not work around it.
- **The page list lives in `src/routes.ts`**. The router (`AppRoutes.tsx`), the nav (`Layout.tsx`), the canonical URLs (`Seo.tsx`) and the generated `sitemap.xml` (`vite.config.ts`) read it. vite-prerender-plugin follows every same-origin link it renders, so each linked page is prerendered without a prerender entry. The `/404` shell is the one route outside the table: `vite.config.ts` lists it for prerendering and the `CustomErrorResponses` of the CloudFront distribution in `infra/template.yaml` serve it for misses.
- **The inline theme script in `index.html` is CSP-allowed by a sha256 hash** pinned in the CSP of `infra/template.yaml`. Editing that script — whitespace included — invalidates the hash and theme resolution silently stops. `src/__tests__/csp.test.ts` fails when the template has another hash.
- **`infra/template.yaml` is the CloudFormation stack `rustatian-me` in us-east-1**: the Route 53 zone with its DNSSEC signing and alarms, the certificate, the S3 bucket, the CloudFront distribution and the deploy role. CI never deploys it. A person deploys each template change from its PR branch with a change set review (README, Infrastructure). Never rename or remove `HostedZone`: the domain registration names the name servers of this zone. Never change `DnssecKey`, `KeySigningKey` or `Dnssec` while the domain registration has the DS record: a wrong key, a wrong key policy or a zone that stops signing makes validating resolvers return SERVFAIL for every name in the zone.
- **Design tokens are `--s-*` / `--r-*` / `--fs-*` / `--fg-*` / `--bg-*` / `--bd-*`** (see `src/styles/tokens.css`). An invented token name produces a declaration the browser silently drops, so the styling just goes missing rather than erroring.

Prefer the `@/` path alias; the codebase uses it almost exclusively.

## Testing

Vitest with jsdom.

## Conventions

- Components are plain arrow functions with a local props interface. No `FunctionalComponent`, no `React.FC`.
- Hooks come from `preact/hooks`.
- Page `<head>` content goes through `<Seo>` in `src/components/Seo/Seo.tsx`. It renders nothing. During prerender it fills the `SeoCollector`, and `prerender()` in `src/index.tsx` returns that head to vite-prerender-plugin. On the client it sets `document.title`. A route without `<Seo>` fails the build.
