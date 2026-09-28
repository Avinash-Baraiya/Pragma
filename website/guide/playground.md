---
layout: page
title: Playground
---

<div class="page-wide">

<header class="page-head">
<p class="hs__kicker">Playground</p>
<h1>Ask the table anything.</h1>
<p>The real Pragma engine, validator, React components and TanStack adapter, running in your browser. Type an instruction or pick an example; the inspector shows exactly what happened.</p>
</header>

<ClientOnly>
<ReactIsland name="playground" min-height="640px" />
</ClientOnly>

<div class="pg-notes">
<article>
<h3>What runs here</h3>
<p>Explicit instructions go through the deterministic parser exactly as in production. A small <strong>simulated model</strong> answers a few sample phrasings, such as “high value accounts”, because this site has no server or API key.</p>
</article>
<article>
<h3>Things to try</h3>
<ul>
<li><code>@</code> for local column autocomplete</li>
<li><code>revenue between 5 lakh and 20 lakh</code></li>
<li><code>recent customers</code>, which asks instead of guessing</li>
<li><code>@internalNotes is empty</code>, a hidden field</li>
<li><code>remove the country filter</code> after adding one</li>
</ul>
</article>
<article>
<h3>Use your own model</h3>
<p>In your app, any phrasing works once you connect a model on your server. <a href="./ai-models">Add a model →</a></p>
</article>
</div>

</div>
