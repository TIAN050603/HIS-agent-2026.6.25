# Playwright Browser Environment

Current HIS base URL:

```bash
HIS_BASE_URL=http://10.26.6.8:31210
```

The current container was checked for existing browsers with:

```bash
which chromium
which chromium-browser
which google-chrome
which google-chrome-stable
which microsoft-edge
ls /usr/bin | grep -i chrome
ls /usr/bin | grep -i chromium
echo $PLAYWRIGHT_BROWSERS_PATH
npx playwright --version
```

Initial result:

- No `chromium`, `chromium-browser`, `google-chrome`, `google-chrome-stable`, or `microsoft-edge` executable was found.
- No chrome/chromium executable was found under `/usr/bin`.
- `PLAYWRIGHT_BROWSERS_PATH` is empty.
- Playwright version is `1.60.0`.

If an existing browser is later provided, run:

```bash
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/path/to/chromium HIS_BASE_URL=http://10.26.6.8:31210 npm run test:e2e -- --reporter=list
```

If no existing browser is available, choose one of these environment setup options:

- Allow `npx playwright install chromium`.
- Allow installing a system Chromium package.
- Provide a known browser executable path and set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`.

Current installed state:

- `npx playwright install chromium` succeeded.
- Browser runtime dependencies were installed with `npx playwright install-deps chromium` after the first launch failed with missing `libnspr4.so`.
- Chromium path: `/root/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome`
- Chromium headless shell path: `/root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell`

Verified command:

```bash
HIS_BASE_URL=http://10.26.6.8:31210 npm run test:e2e -- --reporter=list
```

Latest default E2E result:

- 73 passed
- 3 skipped
- 0 failed

Latest RUN_LLM_E2E result:

- 75 passed
- 1 skipped
- 0 failed
