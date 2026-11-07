# Plugin setup outside the caller's effect

Date: 2026-11-07. Status: **approved by the user 2026-11-07.**
Fixes data-dashboard `DEFERRED.md` → "map-sdk: plugin effects added from inside a host `$effect`
can stop" (monitor-map's diagnosis, section c2).

## Intent

A host must be able to add plugins from inside its own `$effect` without the plugins' effects
silently dying. monitor-map's `syncPlugins` does this, and after a clusters toggle and a pollutant
switch its monitors layers vanished for good, with no error. monitor-map keeps its workaround
(#126, adding and removing plugins outside its effect) until the user decides otherwise; this
change makes the workaround unnecessary.

## Cause (verified)

A Svelte bug, present in 5.57.0 and in 5.57.3 (the latest release on 2026-11-07):

- `$effect.root` created while an effect runs becomes that effect's child (`create_effect` sets
  `parent = active_effect`).
- When that effect re-runs, `destroy_effect_children` cuts its child roots loose
  (`parent = null`) but leaves their sibling links (`next`) in place.
- `Batch#traverse` walks a root's subtree, then climbs and follows `next`, without stopping at the
  root. So walking one loose root also walks the loose roots created after it, which flips their
  `CLEAN` flag back on. When those later roots then get their own walk, the flag flips off and
  stays off.
- From then on, scheduling one of their effects finds the root not `CLEAN`, treats it as already
  queued, and returns. The effect never runs again.

It needs two or more roots created under one effect, the effect re-running, an update that
dirties an earlier and a later root together, and then an update to the later root alone.
`PluginHost#setup` runs `plugin.setup` synchronously, so every `ctx.effect` root is created under
whatever effect called `addPlugin` (`untrack` does not change the active effect). The monitors
plugin calls `ctx.effect` several times.

Evidence: instrumented Svelte in a throwaway monitor-map worktree (release/5.0.0 with `079ee1a`'s
`syncPlugins`), where `c-reset3.mjs noreset` gives Ozone 0 monitor layers and a control run
without the clusters toggle gives 15; and a 20-line Svelte-only client test that reproduces it
with two roots (kept in the session scratchpad, to become the upstream report).

A host-owned effect that runs queued setups does **not** fix it: the plugin roots become that
effect's children, and it re-runs whenever another plugin is queued, cutting the earlier roots
loose. A test confirmed it fails the same way. Running setups from a microtask, where no effect is
active, passes.

## Goals

1. No plugin's `setup` (and so no `ctx.effect` root) runs while the caller's code is on the stack,
   whatever the caller is: an effect, a component script, an event handler, or plain code.
2. A plugin added from inside a host `$effect` keeps redrawing after that effect re-runs, any
   number of times, with any number of plugins.
3. `map.ready` never turns true while plugin setups are queued. It is not turned false by a queue
   that starts after it is true (see the anti-goals). Theme and basemap changes queue nothing.
4. Only public Svelte API. Nothing reaches into Svelte internals.

## Non-goals

- Changing monitor-map. Its workaround stays until the user decides.
- Guarding a plugin that creates `$effect.root`s inside one of its own effects. map-sdk's plugins
  don't; the upstream fix covers the rest.
- Filing the Svelte issue. It is a public action and waits for the user's yes (see "Deferred").
- Publishing. Any release needs the user's yes for that release.

## Anti-goals

- Making `ready` turn false when a plugin is added to a map that is already ready. Hosts gate load
  screens on it, and it would flash on every option change (decided by the user 2026-11-07).
- Synchronous setup kept alive through Svelte internals (`active_effect`), which could break on any
  Svelte upgrade (decided by the user 2026-11-07).

## Behavior (decided by the user 2026-11-07)

- **Deferred setup.** Where host code (which can run inside an effect) would set plugins up, the
  `PluginHost` queues them and sets them up in one microtask (`queueMicrotask`), in list order.
  That covers:
  - `add` while the map is live (style loaded);
  - `attach` when the style is already loaded (`#whenStyleLoaded`'s synchronous branch). In
    practice `attach` meets an unloaded style, but `MapView` calls it from an effect.
- **Immediate setup stays** where only map-sdk's own non-effect callbacks call in (my call, from the
  builder check): the `style.load` and `idle` listeners (first load), and `restyle`, whose only
  callers are basemap's `style.load` listener (`onStyleReady`, a basemap switch) and `themeChanged`
  (internal, "for MapView only", called from `watchTheme`'s MutationObserver/matchMedia callback).
  None of these runs inside an effect. `restyle` gets an explicit "set up now" path so its
  synchronous branch isn't deferred along with `attach`'s. If `themeChanged` ever becomes public
  or is called from an effect, it moves to the deferred list.
- **The plugin list changes at once.** `map.plugins`, the legend list, and selection state include
  a plugin as soon as `addPlugin` returns; only its `setup` (sources, layers, `ctx.effect`) waits.
- **Forcing it.** `flushSync()` cannot run a microtask. `await tick()` does: our microtask is queued
  before `tick`'s, so setup has run and `tick`'s flush then runs the plugins' first effects.
- **`ready`.** `markReady` (called by `MapView` on the first `idle` after a style load) leaves
  `ready` false while setups are queued, and the queued run sets it true once they have run, if the
  map is still attached and was marked ready. Adding a plugin to a ready map never sets it false.
- **The queue follows the host's state**, as `#setupAll` does today. When the microtask runs, it
  skips a plugin that was removed, is already running, or belongs to another map (logged, as
  today), and does nothing if the host was detached, suspended, or re-attached to another gl since.
  `remove`, `detach`, `suspend`, and `restyle` before the microtask need no extra bookkeeping beyond
  that check.

## README

In "Writing a plugin" (and where `addPlugin` is described), say that `setup` runs once the map's
style is ready, and for a plugin added to a ready map, just after the current code finishes (a
microtask), never from inside the caller's code, so adding plugins from an `$effect` is safe. Code
that must see a plugin's layers right after `addPlugin` uses `await tick()`; `flushSync()` does not
run it. In "Ready", say `ready` also waits for queued plugin setups. Keep
`tests/unit/readme-examples.test.ts` in step if an example changes.

## Tests

- **Fails before the fix:** a client test where a host `$effect` adds a plugin whose setup creates
  two `ctx.effect`s, the host effect re-runs, one update dirties both effects, and a second update
  dirties the second alone: the second effect must run. Through `PluginHost` (or `createMap`) with
  the existing fake gl, not raw Svelte. Before the fix it fails like the Svelte-only repro.
- Setup is deferred: right after `add` on a live host, the plugin is in `plugins` but its layers
  are absent; after `await tick()` they are present, and its effects have run.
- Setup on style load, basemap switch, and theme change stays synchronous (existing tests keep
  passing unchanged).
- `ready`: a plugin added between style load and `markReady` holds `ready` false until its setup
  has run; `markReady` with a setup still queued leaves `ready` false, then true after the
  microtask; adding a plugin to a ready map leaves `ready` true throughout.
- Queue edge cases: `remove`, `detach`, `suspend`, and re-`attach` between `add` and the microtask.
- Existing tests that call `flushSync()` right after `add`/`addPlugin` on a live map switch to
  `await tick()`; their assertions stay the same.

## Proof in monitor-map

The setup exists (2026-11-07):

- Throwaway worktree: `/tmp/claude-1000/-home-alex-workspace-sjvair-map-sdk/ad52517b-f666-419c-914d-9a6602b77fa9/scratchpad/mm-repro`
  (detached at monitor-map `origin/release/5.0.0`, `src/lib/map/sync-plugins.svelte.ts` checked
  out from `079ee1a`, `.env` copied, `npm ci` done; its Svelte copy is unpatched again).
- Script: `diag-local/c-reset3.mjs` inside it, a copy of monitor-map's
  `.worktrees/5.0-design/.superpowers/sdd/2026-11-05-monitor-map-5/diag/c-reset3.mjs` and
  `common.mjs` (the original folder must not be edited or deleted). Run from the worktree:
  `node diag-local/c-reset3.mjs noreset`, against `npx vite --port 5181 --strictPort` there.
- Svelte-only repro: `/tmp/claude-1000/-home-alex-workspace-sjvair-map-sdk/ad52517b-f666-419c-914d-9a6602b77fa9/scratchpad/svelte-repro/`.

If they are gone, recreate the worktree the same way (`git -C <monitor-map> worktree add --detach
<dir> origin/release/5.0.0`, then `git checkout 079ee1a -- src/lib/map/sync-plugins.svelte.ts`).

`npm pack` map-sdk and install the tarball there, clear Vite's cache (`node_modules/.vite`), and run
the script: Ozone must show its monitor layers (15 in the control run, 0 before the fix). Check
that port 5181 is free (`ss -ltnp | grep 5181`; if not, ask `monitor-map-2a`) and that the stack is
ingesting first. Stop the dev server by PID and remove the throwaway worktree afterwards
(`git -C <monitor-map> worktree remove`). Never commit in monitor-map.

## Delivery

One PR into `main` from `fix/plugin-setup-outside-effects`; merging waits for the user's yes. Run
`npm run test:bundle` before committing changes under `src/lib`. No release.

Docs (my call): the data-dashboard `DEFERRED.md` entry below is added when this spec is committed.
The existing entry for this bug, and the map-sdk status in `TODO.md`, are marked fixed only after
the PR merges, since merging waits for the user's yes. Until then `TODO.md` says the fix is in
review.

## Deferred (recorded in data-dashboard `DEFERRED.md` in the same change)

- **Upstream Svelte report.** A playground repro (three buttons: re-run the outer effect, update
  both roots, update the second alone; a run count that stops) with the versions and the
  `destroy_effect_children` / `#traverse` lines. Why deferred: filing is public and needs the
  user's yes. Revisit: when the user says to file it, or when a Svelte release fixes it. The
  microtask deferral stays either way: setup outside the caller's code is the safer design.

## Left to the builder

- Where the queue lives (`PluginHost` is the natural home) and how `ready` learns that it has
  drained (for example a host callback that `createMap` wires to `#ready`).
- Exact test file layout and the README wording, within the points above.
