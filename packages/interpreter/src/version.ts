declare const __PRAGMA_VERSION__: string | undefined;

/** Version of the interpreter engine, stamped at build time. Included in cache keys and result metadata. @public */
export const ENGINE_VERSION: string =
  typeof __PRAGMA_VERSION__ === 'string' ? __PRAGMA_VERSION__ : '0.0.0-dev';
