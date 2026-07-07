import {createServer} from 'http';
import {mkdtempSync, rmSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';
import {chromium} from 'playwright';

const endpoint = process.env.RPA_SMOKE_CDP_ENDPOINT;

if (!endpoint) {
  console.log('RPA smoke skipped: set RPA_SMOKE_CDP_ENDPOINT to a managed Chromium CDP endpoint.');
  process.exit(0);
}

const html = `<!doctype html>
<html>
  <body>
    <form>
      <input name="email" />
      <button type="button" data-testid="submit">Submit</button>
    </form>
    <div id="result"></div>
    <script>
      document.querySelector('[data-testid="submit"]').addEventListener('click', () => {
        document.querySelector('#result').textContent = 'ok:' + document.querySelector('[name="email"]').value;
      });
    </script>
  </body>
</html>`;

const server = createServer((_, response) => {
  response.writeHead(200, {'content-type': 'text/html; charset=utf-8'});
  response.end(html);
});

const listen = port =>
  new Promise(resolve => {
    server.listen(port, '127.0.0.1', () => resolve(port));
  });

const close = () => new Promise(resolve => server.close(resolve));

const artifactDir = mkdtempSync(join(tmpdir(), 'chrome-power-rpa-smoke-'));

try {
  const port = await listen(0);
  const address = server.address();
  const url = `http://127.0.0.1:${address.port || port}`;
  const browser = await chromium.connectOverCDP(endpoint);
  const context = browser.contexts()[0] || (await browser.newContext());
  const page = context.pages()[0] || (await context.newPage());
  await page.goto(url);
  await page.locator('[name="email"]').fill('rpa@example.com');
  await page.locator('[data-testid="submit"]').click();
  await page.locator('#result').waitFor({state: 'attached'});
  const text = await page.locator('#result').innerText();
  if (text !== 'ok:rpa@example.com') {
    throw new Error(`Unexpected smoke result: ${text}`);
  }
  await page.screenshot({path: join(artifactDir, 'rpa-smoke.png')});
  await browser.close();
  console.log(`RPA smoke passed. Artifact: ${join(artifactDir, 'rpa-smoke.png')}`);
} finally {
  await close();
  if (process.env.RPA_SMOKE_KEEP_ARTIFACTS !== '1') {
    rmSync(artifactDir, {recursive: true, force: true});
  }
}
