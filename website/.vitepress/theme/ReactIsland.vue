<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import type { Root } from 'react-dom/client';
import { islands, type IslandName } from './islands';

// Mounts a React component on the client only; the static build renders a placeholder.
const props = defineProps<{
  name: IslandName;
  props?: Record<string, unknown>;
  minHeight?: string;
}>();
const el = ref<HTMLElement | null>(null);
const failed = ref(false);
let root: Root | undefined;

onMounted(async () => {
  try {
    const [{ createElement, StrictMode }, { createRoot }, component] = await Promise.all([
      import('react'),
      import('react-dom/client'),
      islands[props.name](),
    ]);
    if (!el.value) return;
    root = createRoot(el.value);
    root.render(createElement(StrictMode, null, createElement(component, props.props ?? {})));
  } catch (error) {
    failed.value = true;
    console.error(error);
  }
});

onBeforeUnmount(() => root?.unmount());
</script>

<template>
  <div class="island" :style="{ minHeight }">
    <p v-if="failed" class="island__error">This demo could not load. Try reloading the page.</p>
    <div ref="el"><div class="island__loading" aria-hidden="true" /></div>
  </div>
</template>
