# @avinash-baraiya/pragma-server

HTTP endpoint for Pragma. Keeps model credentials on the server and resolves schemas from its own registry.

```ts
import { createPragmaHandler, toNodeHandler } from '@avinash-baraiya/pragma-server';

const handler = createPragmaHandler({ schemas: { customers }, provider, authorize, rateLimit });
export const POST = handler; // Next.js, Hono, Bun, Deno, Workers
app.post('/api/pragma', toNodeHandler(handler)); // Express / node:http
```

Completed interpretations return `200`; every failure returns RFC 9457 `application/problem+json` with a stable `code` and the `requestId`.

Docs: [integration](https://pragma-docs.vercel.app/reference/integration) · [security](https://pragma-docs.vercel.app/reference/security) · [errors](https://pragma-docs.vercel.app/reference/errors)
