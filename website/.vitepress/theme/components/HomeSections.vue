<script setup lang="ts">
import { withBase } from 'vitepress';
import PipelineDiagram from './PipelineDiagram.vue';

const worksWith = [
  'React',
  'TanStack Table',
  'Next.js',
  'Express',
  'Hono',
  'Bun',
  'Deno',
  'OpenAI',
  'Claude',
  'Gemini',
  'Ollama',
  'Vercel AI SDK',
];

const steps = [
  {
    n: '01',
    title: 'Understand',
    text: 'The deterministic parser reads explicit instructions locally. It claims one only when it understands every word; anything else goes to your model.',
  },
  {
    n: '02',
    title: 'Validate',
    text: 'Every proposal is checked against your schema: fields, operators, value types, limits. Hidden fields are unreachable. Nothing is guessed.',
  },
  {
    n: '03',
    title: 'Apply & explain',
    text: 'Changes apply to the current query, so follow-ups just work. Chips and explanations come from the validated result, so they match what runs.',
  },
];
</script>

<template>
  <section class="hs hs--logos" aria-label="Works with">
    <p>Works with</p>
    <ul>
      <li v-for="name in worksWith" :key="name">{{ name }}</li>
    </ul>
  </section>

  <section class="hs">
    <header class="hs__head">
      <p class="hs__kicker">How it works</p>
      <h2>The model proposes. The engine decides.</h2>
      <p>
        Natural language is only the input. The source of truth is a typed query checked against
        your schema.
      </p>
    </header>
    <PipelineDiagram />
    <div class="hs__steps">
      <article v-for="step in steps" :key="step.n" class="hs__step">
        <span class="hs__num">{{ step.n }}</span>
        <h3>{{ step.title }}</h3>
        <p>{{ step.text }}</p>
      </article>
    </div>
  </section>

  <section class="hs">
    <header class="hs__head">
      <p class="hs__kicker">Features</p>
      <h2>Everything a query bar needs, nothing it shouldn't do.</h2>
    </header>
    <div class="bento">
      <article class="bento__card bento__card--wide bento__card--stat">
        <div>
          <h3>Local first, model second</h3>
          <p>
            Most instructions never leave the browser. The model is called only for phrasing the
            parser can't fully understand, and answers are cached.
          </p>
        </div>
        <dl class="bento__stats">
          <div>
            <dt>answered without a model</dt>
            <dd>76%</dd>
          </div>
          <div>
            <dt>median local latency</dt>
            <dd>0.46 ms</dd>
          </div>
          <div>
            <dt>full browser bundle</dt>
            <dd>61 kB</dd>
          </div>
        </dl>
      </article>
      <article class="bento__card">
        <h3>Safe by construction</h3>
        <ul class="bento__checks">
          <li class="ok">Field exists and is visible</li>
          <li class="ok">Operator allowed for the type</li>
          <li class="ok">Value coerced and in range</li>
          <li class="no">Hidden fields: unreachable</li>
          <li class="no">Row data: never sent to a model</li>
        </ul>
      </article>
      <article class="bento__card">
        <h3>Asks instead of guessing</h3>
        <p>Ambiguous requests get options that apply instantly, with no second model call.</p>
        <div class="mock" aria-hidden="true">
          <div class="mock__input">recent customers<span class="mock__caret" /></div>
          <div class="mock__panel">
            <strong>What does “recent” mean?</strong>
            <label><i />Last 7 days</label>
            <label class="on"><i />Last 30 days</label>
            <label><i />This month</label>
            <div class="mock__actions">
              <span class="mock__btn">Confirm</span
              ><span class="mock__btn mock__btn--ghost">Dismiss</span>
            </div>
          </div>
        </div>
      </article>
      <article class="bento__card">
        <h3>@ column autocomplete</h3>
        <p>Suggestions come from the schema, locally. Types and aliases included.</p>
        <div class="mock" aria-hidden="true">
          <div class="mock__input">customers with @re<span class="mock__caret" /></div>
          <ul class="mock__list">
            <li class="on"><span>Lifetime Revenue</span><em>number</em></li>
            <li><span>Signed Up</span><em>datetime · “registration date”</em></li>
            <li><span>Verified</span><em>boolean</em></li>
          </ul>
        </div>
      </article>
      <article class="bento__card">
        <h3>Bring your own model</h3>
        <p>
          One small interface. Keys stay on your server, with retries, fallbacks and a circuit
          breaker built in.
        </p>
        <ul class="bento__tags">
          <li>OpenAI-compatible</li>
          <li>Claude</li>
          <li>Gemini</li>
          <li>AI SDK</li>
          <li>Ollama</li>
          <li>Custom</li>
        </ul>
      </article>
      <article class="bento__card bento__card--wide bento__card--shot bento__card--row">
        <div>
          <h3>Refuses what it can't answer</h3>
          <p>
            Requests outside the schema get a reason and suggestions instead of an invented filter.
            Every warning and error has a stable code.
          </p>
          <a :href="withBase('/reference/errors')">Error codes →</a>
        </div>
        <div class="mock" aria-hidden="true">
          <div class="mock__input">profitable customers</div>
          <div class="mock__error">
            There is no profit field; profit would need revenue and cost.
            <span>Try: <b>@revenue</b></span>
          </div>
        </div>
      </article>
    </div>
  </section>
</template>
