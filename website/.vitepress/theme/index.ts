import type { Theme } from 'vitepress';
import DefaultTheme from 'vitepress/theme';
import '../../../packages/react/src/styles.css';
import PlaygroundHost from './PlaygroundHost.vue';
import './custom.css';

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('Playground', PlaygroundHost);
  },
} satisfies Theme;
