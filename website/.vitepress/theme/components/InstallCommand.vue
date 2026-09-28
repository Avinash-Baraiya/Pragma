<script setup lang="ts">
import { ref } from 'vue';

const props = withDefaults(defineProps<{ command?: string }>(), {
  command: 'npm install @avinash-baraiya/pragma',
});
const copied = ref(false);

async function copy() {
  try {
    await navigator.clipboard.writeText(props.command);
    copied.value = true;
    setTimeout(() => (copied.value = false), 1600);
  } catch {
    // Clipboard unavailable (insecure context); the command stays selectable.
  }
}
</script>

<template>
  <button type="button" class="install" :aria-label="`Copy: ${command}`" @click="copy">
    <span class="install__prompt" aria-hidden="true">$</span>
    <code class="install__cmd">{{ command }}</code>
    <span class="install__copy" aria-live="polite">{{ copied ? 'Copied' : 'Copy' }}</span>
  </button>
</template>
