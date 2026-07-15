# TypeScript checks

The repository contains a large legacy type-safety backlog. The production entry graph
currently reports existing errors in old routes and UI modules, while Vite/esbuild can still
produce a deployable bundle.

- `npm run check` runs strict checks for the critical publishing, analytics, VK and Directus
  session modules. This command must stay green.
- `npm run check:production` audits the complete production entry graph. Use it while reducing
  the legacy backlog; existing failures are not hidden or deleted.
- `npm run check:legacy` audits every TypeScript source file, including modules that are not
  reachable from the current application entry points.

Do not delete a file solely because it appears in `check:legacy`: first prove it is unreachable
from both `client/src/main.tsx` and `server/index.ts`, and check dynamic imports and route
registration.
