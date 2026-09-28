<script setup lang="ts">
// How an instruction becomes a TableQuery. Pure SVG, themed by CSS variables.
</script>

<template>
  <figure class="pipeline" aria-label="Instruction to TableQuery pipeline">
    <svg viewBox="0 0 960 250" role="img">
      <title>
        An instruction goes to the deterministic parser; anything it cannot fully understand goes to
        your model on your server. Every proposal is validated, applied and explained, producing a
        TableQuery for any table or backend.
      </title>
      <defs>
        <marker
          id="pl-arrow"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M0 0 L10 5 L0 10 z" class="pl-arrowhead" />
        </marker>
        <linearGradient id="pl-brand" x1="0" x2="1">
          <stop offset="0" stop-color="var(--pl-a)" />
          <stop offset="1" stop-color="var(--pl-b)" />
        </linearGradient>
      </defs>

      <!-- flows -->
      <path class="pl-flow" d="M150 95 H210" marker-end="url(#pl-arrow)" />
      <path class="pl-flow" d="M390 95 H450" marker-end="url(#pl-arrow)" />
      <path class="pl-flow pl-flow--model" d="M300 125 V185 H390" marker-end="url(#pl-arrow)" />
      <path class="pl-flow pl-flow--model" d="M570 185 H610 V125" marker-end="url(#pl-arrow)" />
      <path class="pl-flow" d="M630 95 H690" marker-end="url(#pl-arrow)" />

      <!-- nodes -->
      <g class="pl-node">
        <rect x="10" y="65" width="140" height="60" rx="12" />
        <text x="80" y="91">Instruction</text>
        <text x="80" y="110" class="pl-sub">“active users in India”</text>
      </g>
      <g class="pl-node pl-node--accent">
        <rect x="210" y="65" width="180" height="60" rx="12" />
        <text x="300" y="91">Deterministic parser</text>
        <text x="300" y="110" class="pl-sub">in the browser · ~1 ms</text>
      </g>
      <g class="pl-node pl-node--dashed">
        <rect x="390" y="160" width="180" height="50" rx="12" />
        <text x="480" y="182">Your model</text>
        <text x="480" y="199" class="pl-sub">on your server, only if needed</text>
      </g>
      <g class="pl-node pl-node--accent">
        <rect x="450" y="65" width="180" height="60" rx="12" />
        <text x="540" y="91">Validate · apply</text>
        <text x="540" y="110" class="pl-sub">schema is the authority</text>
      </g>
      <g class="pl-node pl-node--brand">
        <rect x="690" y="65" width="180" height="60" rx="12" />
        <text x="780" y="91">TableQuery</text>
        <text x="780" y="110" class="pl-sub">+ chips · explanation</text>
      </g>

      <!-- outputs -->
      <g class="pl-out">
        <text x="780" y="30">TanStack · your API · SQL · anything</text>
        <path class="pl-flow" d="M780 65 V40" marker-end="url(#pl-arrow)" />
      </g>
    </svg>
  </figure>
</template>
