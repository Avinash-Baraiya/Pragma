import type { ComponentType } from 'react';

/** Interactive React components that pages can embed with `<ReactIsland name="…" />`. */
export const islands = {
  playground: () => import('./Playground').then((m) => m.Playground as ComponentType<object>),
  'hero-demo': () => import('./HeroDemo').then((m) => m.HeroDemo as ComponentType<object>),
  'operator-explorer': () =>
    import('./OperatorExplorer').then((m) => m.OperatorExplorer as ComponentType<object>),
} satisfies Record<string, () => Promise<ComponentType<object>>>;

export type IslandName = keyof typeof islands;
