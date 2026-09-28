<script setup lang="ts">
import { withBase } from 'vitepress';
import ReactIsland from '../ReactIsland.vue';
import InstallCommand from './InstallCommand.vue';
</script>

<template>
  <section class="hh">
    <div class="hh__glow" aria-hidden="true" />
    <div class="hh__copy">
      <p class="hh__eyebrow">Open source · MIT · TypeScript</p>
      <h1 class="hh__title">Let users <span class="hh__grad">ask your tables</span> anything.</h1>
      <p class="hh__lead">
        Pragma turns plain language into a validated search, filter, sort and pagination query that
        any table, API or database can run. Explicit requests are answered in the browser in about a
        millisecond; your own model handles the rest.
      </p>
      <InstallCommand />
      <div class="hh__actions">
        <a class="hh__btn hh__btn--brand" :href="withBase('/guide/getting-started')">Get started</a>
        <a class="hh__btn" :href="withBase('/guide/playground')">Open playground</a>
        <a class="hh__btn hh__btn--ghost" href="https://github.com/Avinash-Baraiya/Pragma"
          >GitHub</a
        >
      </div>
    </div>
    <div class="hh__demo">
      <ReactIsland name="hero-demo" min-height="470px" />
    </div>
  </section>
</template>
