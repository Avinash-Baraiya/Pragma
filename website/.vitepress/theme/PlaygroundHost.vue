<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import type { Root } from 'react-dom/client';

// React is mounted on the client only; the static build renders a placeholder.
const props = defineProps<{ stage?: boolean }>();
const el = ref<HTMLElement | null>(null);
const failed = ref(false);
let root: Root | undefined;

onMounted(async () => {
  try {
    const [{ createElement, StrictMode }, { createRoot }, { Playground }] = await Promise.all([
      import('react'),
      import('react-dom/client'),
      import('./playground/Playground'),
    ]);
    if (!el.value) return;
    root = createRoot(el.value);
    root.render(createElement(StrictMode, null, createElement(Playground, { stage: props.stage })));
  } catch (error) {
    failed.value = true;
    console.error(error);
  }
});

onBeforeUnmount(() => root?.unmount());
</script>

<template>
  <div class="pg-host">
    <p v-if="failed" class="pg-host__error">
      The playground could not load. Try reloading the page.
    </p>
    <div ref="el"><p class="pg-host__loading">Loading playground…</p></div>
  </div>
</template>
