import type { Theme } from 'vitepress';
import DefaultTheme from 'vitepress/theme';
import '../../../packages/react/src/styles.css';
import HomeHero from './components/HomeHero.vue';
import HomeSections from './components/HomeSections.vue';
import InstallCommand from './components/InstallCommand.vue';
import PipelineDiagram from './components/PipelineDiagram.vue';
import ReactIsland from './ReactIsland.vue';
import './custom.css';

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('ReactIsland', ReactIsland);
    app.component('HomeHero', HomeHero);
    app.component('HomeSections', HomeSections);
    app.component('InstallCommand', InstallCommand);
    app.component('PipelineDiagram', PipelineDiagram);
  },
} satisfies Theme;
