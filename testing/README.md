# Task graph visual regression

This suite mounts the real client component in React and renders it in Chromium.
RPC responses are synthetic and validated against `remote.mjs`. It never starts
DSH, opens a real session, writes graph state, or requests a model. Host colors
are represented by a small light/dark token fixture; this is component/browser
coverage, not a complete DSH integration test.

Fixtures cover 128 nodes, 512 edges, a 127-task chain, 48 branches, a
16-level legacy tree, 512-character labels, conditional routes, mixed dispositions,
blocked/recovery/pause/completed/planning states, and expanded hierarchical groups.
Group cases include uneven parallel groups, independent long group dependencies,
nested groups, 12 groups with 115 leaves, and long group titles. The runner checks
initial position, fit/zoom/navigation, preservation across polling, condition details,
keyboard dialog return, pause/resume, group collapse and task search through the
fake RPC. Desktop defaults to expanded groups; narrow screens retain level view.
Exact case, interaction and screenshot counts are recorded in each run's results.

Use disposable dependencies, outside the installed DSH profile:

```sh
npm install --prefix /tmp/task-graph-ui-deps --no-audit --no-fund --ignore-scripts \
  react@19.2.0 react-dom@19.2.0 esbuild@0.25.12 playwright@1.58.2 zod@4.6.7
```

Run from the workspace with Node 24 (the workspace `./project-run` wrapper is
also suitable). Supply the path of an available Chromium binary:

```sh
DSH_UI_TEST_DEPS=/tmp/task-graph-ui-deps/node_modules \
DSH_UI_TEST_ZOD=/tmp/task-graph-ui-deps/node_modules/zod/index.js \
DSH_UI_TEST_CHROME=/absolute/path/to/chrome \
node /absolute/path/to/package/testing/visual-check.mjs /tmp/task-graph-ui-results
```

`DSH_UI_TEST_CASES=chain-desktop,long-mobile` selects individual cases.
`DSH_UI_TEST_SOURCE=/path/to/saved/source` chooses a source snapshot containing
`client.source.mjs` and `view-model.mjs`. Add `DSH_UI_TEST_BASELINE=1` for old UI
snapshots: captures and RPC/edge-preservation checks still run, while assertions
about the newly introduced controls and geometry are disabled. Results identify
baseline mode explicitly.

`RESULTS.json` records geometry, errors, interactions, and unexpected network
requests. A test failure yields a non-zero exit code. Browser contexts and the
loopback-only HTTP server are closed in `finally`. Keep screenshots and results;
remove the disposable dependency directory when finished.
