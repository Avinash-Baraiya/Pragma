import type { IncomingMessage, ServerResponse } from 'node:http';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin, type ViteDevServer } from 'vite';

/** Resolve workspace packages from TypeScript source during development. */
const sourceConditions = ['@pragma/source'];

type NodeMiddleware = (
  req: IncomingMessage,
  res: ServerResponse,
  next: (error?: unknown) => void,
) => void;

/**
 * Mounts the Pragma server handler at /api/pragma on the dev server. The
 * middleware is registered before Vite's own (so POSTs are not answered by the
 * SPA fallback) and the handler is built lazily on first use.
 *
 * In production, mount `createPragmaHandler` in your own backend instead.
 */
function pragmaApi(): Plugin {
  let mode = 'development';
  const build = async (server: ViteDevServer): Promise<NodeMiddleware> => {
    const env = { ...process.env, ...loadEnv(mode, process.cwd(), '') };
    const { createDemoHandler } = (await server.ssrLoadModule(
      '/server/pragma.ts',
    )) as typeof import('./server/pragma.js');
    const { toNodeHandler } = (await server.ssrLoadModule(
      '@pragma/server',
    )) as typeof import('@pragma/server');
    const { handler, provider } = await createDemoHandler(env);
    server.config.logger.info(`  Pragma API ready at /api/pragma (model provider: ${provider})`);
    return toNodeHandler(handler) as NodeMiddleware;
  };
  return {
    name: 'pragma-api',
    configResolved(config) {
      mode = config.mode;
    },
    configureServer(server) {
      let middleware: Promise<NodeMiddleware> | undefined;
      server.middlewares.use('/api/pragma', (req, res, next) => {
        middleware ??= build(server);
        middleware.then((handle) => handle(req, res, next)).catch(next);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), pragmaApi()],
  resolve: { conditions: sourceConditions },
  ssr: { resolve: { conditions: sourceConditions, externalConditions: sourceConditions } },
});
