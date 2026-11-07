# Plugin setup outside the caller's effect: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A plugin added from inside a host `$effect` keeps redrawing after that effect re-runs,
because `PluginHost` sets plugins up from a microtask instead of from the caller's code.

**Architecture:** `PluginHost` gets a one-shot microtask queue: `add` on a live host, and `attach`
on an already-loaded style, schedule `#setupAll()` in `queueMicrotask` instead of calling it.
GL-event paths (`style.load`/`idle`, `restyle`) stay synchronous. `createMap` holds `ready` back
while the host has setups queued.

**Tech Stack:** Svelte 5.57.3 runes, TypeScript, Vitest (projects `unit`, `client`, `browser`),
Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-11-07-plugin-setup-outside-effects-design.md` (read it
first: the cause section explains why a host-owned effect does not work and a microtask does).

## Global Constraints

- Only public Svelte API. Never import or touch Svelte internals (`active_effect` etc.).
- `flushSync()` does not run the queued setups; `await tick()` does. Tests that need setup done use
  `await tick()`.
- `ready` never turns true while setups are queued, and adding a plugin to a ready map never sets
  it false.
- Style-load, basemap-switch and theme-change setup stay synchronous.
- Tabs, double quotes, no trailing commas, print width 100; `npm run format` before committing.
- Run `npm run test:bundle` before committing any change under `src/lib`.
- No Claude or AI attribution in commits or the PR. No push, merge, tag, release, or publish
  without the user's explicit yes for that action.
- Never modify monitor-map (the throwaway worktree in Task 5 is not committed to).

## Review Focus

1. **Rebuild in one pass:** `remove("monitors")` then `add(newMonitorsPlugin)` with the same id,
   before the microtask runs (what monitor-map's `syncPlugins` does). The new object is set up
   exactly once; the old one is never set up. Test in Task 1.
2. **Removed before the microtask:** a plugin added then removed before the microtask is never set
   up and its teardown is never called. Test in Task 1.
3. **Detached before the microtask:** `detach()` (or `suspend()`) before the microtask means no
   setup and no call on the old gl; a later `attach` of a new gl sets everything up once. Test in
   Task 1.
4. **A setup that adds a plugin:** a plugin whose `setup` calls `host.add(other)` during the queued
   run gets `other` set up in a follow-up microtask, once. Test in Task 1.
5. **A setup that throws:** it is logged as today, the other queued plugins still set up, and
   `ready` still turns true afterwards. Test in Task 2.

---

### Task 1: Deferred setup in `PluginHost`

**Files:**
- Create: `tests/fixtures/effect-host.svelte.ts`
- Modify: `src/lib/core/plugin-host.svelte.ts` (`PluginHostOptions`, `add`, `attach`, `restyle`,
  `#whenStyleLoaded`, `PluginHost` class doc comment, the `#setup` comment "setup may be called
  from inside an effect")
- Test: `tests/client/core/plugin-host.test.ts`

**Interfaces:**
- Produces, in `plugin-host.svelte.ts`:
  - `PluginHostOptions.onSettled?: () => void`: called after each queued run finishes (also when
    it found nothing to do), never for synchronous setups.
  - `PluginHost.pending: boolean` (getter, not reactive): true from scheduling until the queued run
    starts.
- Produces, in `tests/fixtures/effect-host.svelte.ts`:
  - `rerunnable(fn: () => void): { rerun(): void; stop(): void }`: a `$effect` inside its own
    `$effect.root` that reads an internal `$state` counter and calls `fn` untracked; `rerun()`
    bumps the counter.
  - `twoEffectPlugin(id: string): { plugin: MapPlugin; runs: { first: number; second: number };
    bump(which: "first" | "second"): void }`: a plugin whose `setup` calls `ctx.effect` twice, the
    first effect reading one `$state` value and counting into `runs.first`, the second reading
    another and counting into `runs.second`.

- [ ] **Step 1: Write the fixture and the failing test**

In `plugin-host.test.ts`, a new `describe("setup outside the caller's effect")`:

```ts
it("keeps a plugin's effects running after the effect that added it re-runs", async () => {
	const { host } = makeHost();
	host.attach(createFakeGl({ styleLoaded: true }));
	await tick();
	const { plugin, runs, bump } = twoEffectPlugin("p");
	let added = false;
	const caller = rerunnable(() => {
		if (added) return;
		added = true;
		host.add(plugin);
	});
	flushSync();
	await tick();
	caller.rerun();
	flushSync();
	bump("first");
	bump("second");
	flushSync();
	bump("second");
	flushSync();
	expect(runs).toEqual({ first: 2, second: 3 });
	caller.stop();
});
```

- [ ] **Step 2: Run it and confirm it fails for the right reason**

Run: `npx vitest run --project client tests/client/core/plugin-host.test.ts -t "re-runs"`
Expected: FAIL, `expected { first: 2, second: 2 } to deeply equal { first: 2, second: 3 }`. Any
other failure means the test does not model the bug; fix the test before going on.

- [ ] **Step 3: Write the deferral tests (failing)**

In the same `describe`:
- `"defers setup of a plugin added to a live host to a microtask"`: on a live host, after `add`,
  `host.plugins` contains the plugin and `gl.layers` has none of its layers, `host.pending` is
  true, and `flushSync()` changes nothing. After `await tick()` the layers are there and the
  plugin's `setup` ran once.
- `"defers setup when attached to an already-loaded style"`: `add` two plugins, then `attach` a
  `createFakeGl({ styleLoaded: true })`: no layers yet; after `await tick()` both are set up, in
  list order.
- `"sets up synchronously on style.load"`: `attach` an unloaded fake gl, `add`, then
  `gl.fireStyleLoad()`: layers present at once, `host.pending` false.
- `"sets up synchronously on restyle"`: live host with a plugin set up, `host.restyle()` on a
  loaded style: torn down and set up again at once.
- `"sets up a plugin re-added under the same id once"` (Review Focus 1): `add(a1)`; `remove("a")`;
  `add(a2)` (same id), all before the microtask: after `await tick()`, `a2`'s setup ran once, `a1`'s
  never.
- `"never sets up a plugin removed before the microtask"` (Review Focus 2): its setup and teardown
  never ran.
- `"does nothing after detach or suspend before the microtask"` (Review Focus 3): no setup, no
  `addLayer` on the old gl; then `attach(newGl)` with a loaded style and `await tick()` sets each
  plugin up once on `newGl`.
- `"sets up a plugin added by another plugin's setup"` (Review Focus 4): after two `await tick()`s,
  `other` is set up once.
- `"calls onSettled after each queued run"`: a host built with `onSettled: vi.fn()`; called once
  after `await tick()` for an `add` on a live host; not called by `fireStyleLoad()` or `restyle()`.

Run: `npx vitest run --project client tests/client/core/plugin-host.test.ts`
Expected: the new tests fail (`pending` undefined, layers present too early), except the two
"synchronously" tests and the "removed before" one, which may already pass.

- [ ] **Step 4: Implement the queue in `plugin-host.svelte.ts`**

- `#setupQueued = false`. `#queueSetup()`: if already queued return; set it, capture `gl = this.#gl`,
  `queueMicrotask(() => { this.#setupQueued = false; if (this.#gl === gl && this.#live)
  this.#setupAll(); this.#opts.onSettled?.(); })`. `#setupAll` already skips removed, running and
  foreign-owned plugins and stops on detach.
- `get pending()` returns `#setupQueued`.
- `add`: when `#live`, call `#queueSetup()` instead of `#setup(plugin)`.
- `#whenStyleLoaded(now: boolean)`: on a loaded style, set `#live = true` and either call
  `#setupAll()` (`now`) or `#queueSetup()`. `attach` passes `false`, `restyle` passes `true`; the
  event listener path is unchanged (synchronous).
- `#live` is set before the microtask, so an `add` while queued just joins the queued run.
- Update the doc comments: setup never runs inside the caller's code; say why in one line (Svelte
  cuts loose `$effect.root`s created inside an effect when it re-runs, and their effects can stop;
  see the spec).

- [ ] **Step 5: Convert this file's existing tests**

Tests that `attach` a loaded fake gl or `add` to a live host and then assert setup synchronously
get `await tick()` (make the `it` async) at the point where setup must have happened. Assertions
stay the same. Do not touch tests whose setup comes from `fireStyleLoad()` or `restyle()`.

- [ ] **Step 6: Run this file**

Run: `npx vitest run --project client tests/client/core/plugin-host.test.ts`
Expected: all pass, including the Step 1 test.

- [ ] **Step 7: Commit**

```bash
git add src/lib/core/plugin-host.svelte.ts tests/client/core/plugin-host.test.ts tests/fixtures/effect-host.svelte.ts
git commit -m "Plugin host sets plugins up in a microtask, outside the caller's effect"
```

### Task 2: `ready` waits for queued setups

**Files:**
- Modify: `src/lib/core/create-map.svelte.ts` (`MapContext.ready` doc comment, `markReady`,
  `attach`'s `onStyleChange` callback, `detach`, the `PluginHost` construction)
- Test: `tests/client/core/ready.test.ts`

**Interfaces:**
- Consumes: `PluginHost.pending`, `PluginHostOptions.onSettled` (Task 1).
- Produces: no new public API. `ready` semantics only.

- [ ] **Step 1: Write the failing tests in `ready.test.ts`**

`setUp()` attaches a loaded fake gl, which now queues setups; existing tests call `markReady()`
synchronously after it, so they test the "held back" path. Make them `await tick()` after `setUp()`
where they mean "settled", keeping their assertions. New tests:
- `"markReady with setups queued waits for them"`: `setUp()` with a plugin added before attach;
  `markReady()` at once: `ready` false; after `await tick()`: true, and the plugin's layers exist.
- `"a plugin added between style load and markReady holds ready back"`: settled map, not yet
  marked; `addPlugin(p)`; `markReady()`: false; after `await tick()`: true.
- `"adding a plugin to a ready map leaves ready true"`: settled and ready; `addPlugin(p)`: `ready`
  is true right after, and after `await tick()`.
- `"detach while held back clears it"`: `markReady()` with setups queued, then `detach()`, then
  `await tick()`: `ready` false.
- `"a basemap switch while held back stays false until the next markReady"`: held back, then
  `basemap.select("dark")`, `await tick()`, `gl.fireStyleLoad()`: false; `markReady()`: true.
- `"a setup that throws still lets ready turn true"` (Review Focus 5): one plugin's `setup` throws
  (spy on `console.error`), another is fine: after `markReady()` and `await tick()`, `ready` is true,
  the good plugin's layers exist, and the error was logged once.

Run: `npx vitest run --project client tests/client/core/ready.test.ts`
Expected: the new "held back" tests fail (`ready` true too early).

- [ ] **Step 2: Implement in `create-map.svelte.ts`**

- `#readyRequested = false`.
- `markReady()`: if no gl, return; if `#host.pending`, set `#readyRequested = true`; else
  `#ready = true`.
- Pass `onSettled` to the `PluginHost`: if `#readyRequested` and `#gl`, set `#ready = true`; always
  clear `#readyRequested`.
- Clear `#readyRequested` wherever `#ready` is set false (`detach`, the basemap `onStyleChange`
  callback).
- `ready` doc comment: add "and any queued plugin setups have run".

- [ ] **Step 3: Run the file**

Run: `npx vitest run --project client tests/client/core/ready.test.ts`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add src/lib/core/create-map.svelte.ts tests/client/core/ready.test.ts
git commit -m "ready waits for queued plugin setups"
```

### Task 3: The rest of the suite

**Files:**
- Modify: whichever tests fail below, most likely `tests/client/core/create-map.test.ts`,
  `basemap.test.ts`, `camera.test.ts`, `interactions.test.ts`, `scoped-context.test.ts`,
  `tests/client/plugins/*.test.ts`, `tests/client/presets/*.test.ts`, and `tests/browser/**`.

- [ ] **Step 1: Run everything and list the failures**

Run: `npm test 2>&1 | tail -80`
Expected: failures only where a test asserts setup (layers, sources, images, effects, router
registrations) synchronously after `attach` on a loaded style or after `addPlugin`/`add` on a live
map.

- [ ] **Step 2: Convert them**

For each, add `await tick()` (async `it`) where setup must have happened, or, in browser tests that
already wait for the map, keep their waits and add `await tick()` only if still needed. Never
change what a test asserts. A failure of any other kind is a real regression: stop and report it
instead of converting it.

- [ ] **Step 3: Run the full checks**

Run: `npm test && npm run check && npm run lint && npm run test:bundle`
Expected: all pass.

Run: `npx playwright test --project chromium --project firefox`
Expected: all pass (WebKit runs in CI only).

- [ ] **Step 4: Commit**

```bash
git add tests
git commit -m "Tests wait for deferred plugin setup with tick()"
```

### Task 4: README

**Files:**
- Modify: `README.md` ("Writing a plugin" near line 296, where `addPlugin` is described near line
  150, and "Ready, and reaching the GL map" near line 422)
- Test: `tests/unit/readme-examples.test.ts` (only if an example changes)

- [ ] **Step 1: Edit the README**

- "Writing a plugin": `setup` runs once the map's style is ready; for a plugin added to a ready map,
  just after the current code finishes (a microtask), never inside the caller's code, so adding and
  removing plugins from an `$effect` is safe.
- Where `addPlugin` is described: the plugin is in `map.plugins` at once; code that must see its
  layers right after `addPlugin` uses `await tick()`; `flushSync()` does not run setup.
- "Ready": `ready` also waits for queued plugin setups.

- [ ] **Step 2: Check**

Run: `npm run check && npm run lint && npx vitest run --project unit tests/unit/readme-examples.test.ts`
Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add README.md tests/unit/readme-examples.test.ts
git commit -m "README: plugin setup runs after the current code; tick() waits for it"
```

### Task 5: Proof in monitor-map, then the PR

**Files:** none in map-sdk. The throwaway monitor-map worktree is described in the spec, "Proof in
monitor-map" (paths, how to recreate it, port and ingest checks). Never commit there.

- [ ] **Step 1: Pack map-sdk**

Run: `npm pack --pack-destination /tmp/claude-1000/-home-alex-workspace-sjvair-map-sdk/ad52517b-f666-419c-914d-9a6602b77fa9/scratchpad`
(or the current session's scratchpad). Expected: a `sjvair-map-sdk-0.1.0-beta.2.tgz`.

- [ ] **Step 2: Baseline, before installing**

In the throwaway worktree, with port 5181 free and the stack ingesting: start
`npx vite --port 5181 --strictPort` (note its PID), run `node diag-local/c-reset3.mjs noreset`.
Expected: `ozone: monitorLayers=0`. If it isn't 0, stop: the repro setup changed, so report it
before going on.

- [ ] **Step 3: Install the tarball and re-run**

Stop the dev server by PID, `npm install <tarball>`, `rm -rf node_modules/.vite`, start it again,
run the script twice. Expected: `ozone: monitorLayers=` the same non-zero count as `pm25` (15 in
the control run), both times. Then run `node diag-local/c-reset3.mjs control`: same counts.

- [ ] **Step 4: Clean up**

Stop the dev server by PID. `git -C /home/alex/workspace/sjvair/monitor-map worktree remove --force
<throwaway path>`. Do not delete monitor-map's `.worktrees/5.0-design` or its diag files.

- [ ] **Step 5: Open the PR (ask first)**

Ask the user before pushing. With a yes: push `fix/plugin-setup-outside-effects` and open one PR
into `main` with the cause, the fix, the timing change for hosts (`await tick()`, not
`flushSync()`), and the monitor-map proof numbers. No AI attribution. Never merge without the
user's yes. Tell the coordinator (`data-dashboard-23`) the PR is open, and set map-sdk's line in
data-dashboard `TODO.md` to "fix in review" from the docs worktree (`.worktrees/docs-map-sdk`,
fetched and rebased, prettier, docs-only commit to its `main`).

- [ ] **Step 6: After the user merges**

In the docs worktree: mark data-dashboard `DEFERRED.md` → "map-sdk: plugin effects added from
inside a host `$effect` can stop" fixed (with the PR number), keep the "upstream Svelte report"
entry open, update map-sdk's `TODO.md` line, and tell the coordinator and `monitor-map-2a` (its
workaround can go whenever the user decides; the fix ships in the next beta, which needs the
user's yes).
