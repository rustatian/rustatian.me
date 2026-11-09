# 🚀 rustatian.me

Personal portfolio site: a statically prerendered [Preact](https://preactjs.com/) frontend built with [Vite](https://vitejs.dev/), served from a [Cloudflare Worker](https://developers.cloudflare.com/workers/) that also proxies the GitHub API behind an edge cache.

---

## ⚡ Quick Start

### 1. 📦 Install dependencies

```bash
bun install
```

### 2. 🏃 Run the development server

```bash
bun run dev
```

Runs `wrangler dev`, serving the worker and the built assets together at [http://localhost:8787](http://localhost:8787). This is the realistic target — the API routes only exist in the worker.

For frontend-only work, `bun run dev:vite` starts the plain Vite server, but `/api/*` requests will 404.

Live GitHub data needs a token. Create a `.dev.vars` file (gitignored) with:

```
GITHUB_TOKEN=ghp_your_token_here
```

A fine-grained token with no extra scopes is enough; the site reads only public profile and contribution data.

### 3. 🏗️ Build for production

```bash
bun run build:prod
```

Output lands in `dist/`, with `/`, `/about`, `/contact` and `/404` prerendered to static HTML.

The GitHub data for the static site comes from `ghdata/`, a Go program with the standard library only. After the build, it writes `api/v1/github/user` and `api/v1/github/contributions` into `dist/`:

```bash
cd ghdata && GITHUB_TOKEN=$(gh auth token) go run . ../dist
```

It writes no file when a GitHub answer fails its checks. Its tests run with `go test ./...` in `ghdata/`.

### 4. 👀 Preview the production build

```bash
bun run preview
```

---

## 🛠️ Technologies

- **Preact** — ⚛️ lightweight alternative to React (React aliased to `preact/compat`)
- **Vite** — ⚡ build tool, with prerendering for static site generation
- **Cloudflare Workers** — ☁️ asset serving, GitHub API proxy, edge caching, CSP
- **CSS Modules** — 🎨 component styles over a shared custom-property token set
- **@tanstack/react-query** — 🔄 asynchronous data management
- **Zod** — ✅ runtime response validation on both sides of the proxy
- **TypeScript** — 🔒 type safety
- **Vitest** — 🧪 unit and worker tests

---

## 📂 Project Structure

```
src/
  api/         # 🌐 Client-side fetch layer, schemas, cache policy
  worker/      # ☁️ Worker-side GitHub transforms and error types
  assets/      # 🖼️ Static resources (icons, images)
  components/  # 🧩 UI components (ui/ holds shared primitives)
  data/        # 📇 Page content (profile, timeline, skills)
  hooks/       # 🪝 Custom hooks
  pages/       # 📄 Application pages
  styles/      # 🎨 Design tokens and global CSS
  utils/       # 🛠️ Utilities
  index.tsx    # 🚪 Client entry point + prerender hook
  worker.ts    # 🚪 Cloudflare Worker entry point
```

---

## ⚙️ Scripts

| Purpose                  | Command                 |
| ------------------------ | ----------------------- |
| 🚀 Start dev server      | `bun run dev`           |
| 🎨 Frontend-only dev     | `bun run dev:vite`      |
| 🏗️ Build for production  | `bun run build:prod`    |
| 👀 Preview build         | `bun run preview`       |
| 🧪 Run tests             | `bun run test`          |
| 📊 Test coverage         | `bun run test:coverage` |
| 🔒 Typecheck             | `bun run typecheck`     |
| 🧹 Lint code             | `bun run lint`          |
| ✨ Format & fix          | `bun run format:fix`    |
| ✅ Full pre-commit check | `bun run check`         |
| ☁️ Deploy                | `bun run deploy`        |

`bun run check` runs typecheck, lint, tests and a production build — the same gate CI enforces.

---

## 🧪 Linting and Formatting

- **[Biome](https://biomejs.dev/)** handles both linting and formatting (`biome.json`).
- Staged files are checked automatically before commits via Husky and lint-staged.

---

## 📝 License

See the [LICENSE](./LICENSE) file.
