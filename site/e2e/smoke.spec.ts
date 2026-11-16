// A smoke test of the built site on the real data: that the page loads whole,
// answers the reader's main interactions, and keeps the URL as the source of
// truth. The data is refreshed from time to time, so figures are compared
// with each other, never with fixed amounts, and no test names a PR or a
// person: a PR is taken from the table, and a login is checked for its form
// without being printed, even when the check fails.

import { type Locator, type Page, expect, test } from '@playwright/test';

const REPO = 'https://github.com/jhoblitt/ceph-dev-stats';
const DATA_REPO = 'https://github.com/ceph/ceph';
/** GitHub's form of a login (`site/src/lib/handles.ts`), as a user page's address. */
const USER_PAGE = /^https:\/\/github\.com\/[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;

/** Console errors, uncaught exceptions and failed requests, checked after every test. */
let problems: string[] = [];

function watch(page: Page): void {
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
  page.on('requestfailed', (r) => problems.push(`request failed: ${r.url()}: ${r.failure()?.errorText ?? ''}`));
  page.on('response', (r) => {
    if (r.status() >= 400) problems.push(`HTTP ${r.status()}: ${r.url()}`);
  });
}

test.beforeEach(({ page, context }) => {
  problems = [];
  watch(page);
  // A page a test opens itself is watched too.
  context.on('page', watch);
});

test.afterEach(() => {
  expect(problems).toEqual([]);
});

/** The weekly (or monthly) counts of PRs opened, merged and closed, the first chart on the page. */
function countsChart(page: Page): Locator {
  return page.getByRole('figure', { name: /^PRs opened, merged and closed unmerged, per / });
}

/** The chart's text alternative: its headline figures, as sentences. */
async function headline(page: Page): Promise<string> {
  const id = await countsChart(page).getAttribute('aria-describedby');
  return (await page.locator(`[id="${id}"]`).textContent()) ?? '';
}

function prTable(page: Page): Locator {
  return page.getByRole('region', { name: 'Pull requests', exact: true });
}

/** The number of PRs the table says it lists. */
async function tableCount(page: Page): Promise<number> {
  const text = (await prTable(page).getByRole('status').textContent()) ?? '';
  const m = /^(no|[\d,]+) PRs? /.exec(text);
  expect(m, `the table's count: ${text}`).not.toBeNull();
  return m![1] === 'no' ? 0 : Number(m![1]!.replaceAll(',', ''));
}

/**
 * Brings the PR table on screen, as a reader scrolling down would, and waits
 * for the titles it then fetches: until no drawn row lacks its title and the
 * table is no longer busy loading any year's file. Returns the table.
 */
async function tableReady(page: Page): Promise<Locator> {
  const section = prTable(page);
  await section.scrollIntoViewIfNeeded();
  const rows = section.getByRole('table', { name: /^Pull requests, sorted / });
  await expect(rows.getByRole('row').nth(1)).toBeVisible();
  await expect(rows.getByRole('button', { name: /^Show #\d+$/ })).toHaveCount(0);
  await expect(rows).toHaveAttribute('aria-busy', 'false');
  await expect(section.getByText(/could not be loaded/)).toHaveCount(0);
  return rows;
}

/** How long the first figures may take: the default period loads every year, and the workers load the page at once. */
const FIRST_FIGURES = 20_000;

async function open(page: Page, hash = ''): Promise<void> {
  await page.goto(hash === '' ? './' : `./${hash}`);
  await expect(countsChart(page)).toBeVisible({ timeout: FIRST_FIGURES });
}

/** The bar the period controls are pinned to the top of the viewport in, while they are. */
function banner(page: Page): Locator {
  return page.locator('.period-banner');
}

/** How far down the viewport the pinned period controls reach: 0 while they are in their place. */
async function bannerBottom(page: Page): Promise<number> {
  return banner(page).evaluate((el) => (getComputedStyle(el).position === 'fixed' ? el.getBoundingClientRect().bottom : 0));
}

test('the page loads whole, with every section', async ({ page }) => {
  await open(page);
  await expect(page.getByRole('heading', { level: 1, name: 'Ceph pull requests' })).toBeAttached();
  for (const name of ['Filters', 'Velocity', 'Review', 'AI use', 'Each PR', 'Timelines', 'Pull requests', 'People']) {
    await expect(page.getByRole('heading', { level: 2, name, exact: true }), name).toBeAttached();
  }
  await expect(page.getByRole('alert')).toHaveCount(0);
  // The table's title files are fetched only once it is on screen; waiting
  // for them puts their requests among those checked.
  await tableReady(page);
});

test('an address naming a section opens there once the page settles, and each section heading links to its own', async ({
  page,
}) => {
  await open(page, '#/?section=people');
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  await page.waitForLoadState('networkidle');
  const heading = page.getByRole('heading', { level: 2, name: 'People', exact: true });
  const top = (await heading.boundingBox())?.y ?? -1;
  // Below the period controls pinned to the top of the viewport, and not far below them.
  const below = await bannerBottom(page);
  expect(below, 'the pinned period controls').toBeGreaterThan(0);
  expect(top, 'the People heading, from the top of the viewport').toBeGreaterThanOrEqual(below);
  expect(top, 'the People heading, from the top of the viewport').toBeLessThan(below + 100);
  await expect(page.locator('#people')).toBeFocused();

  for (const name of ['Velocity', 'Review', 'AI use', 'Each PR', 'Timelines', 'Pull requests', 'People']) {
    await expect(page.getByRole('link', { name: `Link to the ${name} section`, exact: true }), name).toHaveCount(1);
  }
  await expect(page.getByRole('link', { name: 'Link to the Review section', exact: true })).toHaveAttribute(
    'href',
    /#\/\?target=main&section=review$/,
  );
});

test('the page opens on the whole history, the last six months one choice away and back', async ({ page }) => {
  await open(page);
  const period = page.getByRole('group', { name: 'Period' });
  const all = period.getByRole('button', { name: /^All, from / });
  const recent = period.getByRole('button', { name: 'Last 6 months', exact: true });
  const from = period.getByLabel('From');
  await expect(all).toHaveAttribute('aria-pressed', 'true');
  await expect(recent).toHaveAttribute('aria-pressed', 'false');
  // The whole window: the first day the start may take, and no period in the address.
  await expect(from).toHaveValue((await from.getAttribute('min')) ?? '');
  await expect(page).not.toHaveURL(/[#&?](from|to)=/);
  await expect(page.getByRole('group', { name: 'Target' }).getByRole('radio', { name: 'main' })).toBeChecked();
  const whole = await headline(page);

  await recent.click();
  await expect(page).toHaveURL(/[#&?]from=\d{4}-\d{2}-\d{2}(&|$)/);
  await expect(recent).toHaveAttribute('aria-pressed', 'true');
  await expect(all).toHaveAttribute('aria-pressed', 'false');
  await expect(countsChart(page)).not.toHaveAccessibleDescription(whole);

  await all.click();
  await expect(page).not.toHaveURL(/[#&?](from|to)=/);
  await expect(countsChart(page)).toHaveAccessibleDescription(whole);
});

test('changing the Target filter changes the headline figures', async ({ page }) => {
  await open(page);
  const target = page.getByRole('group', { name: 'Target' });
  await expect(target.getByRole('radio', { name: 'main' })).toBeChecked();
  const before = await headline(page);
  expect(before).not.toBe('');

  await target.getByRole('radio', { name: 'all' }).check();
  await expect(page).toHaveURL(/[#&?]target=all(&|$)/);
  await expect(countsChart(page)).not.toHaveAccessibleDescription(before);
});

// The whole history, which the page opens on, steps by month; the last six
// months step by week.
for (const { name, choose, status } of [
  { name: 'a month of the whole history', choose: null, status: / opened in [A-Z][a-z]+ \d{4}$/ },
  { name: 'a week of the last six months', choose: 'Last 6 months', status: / opened in the / },
]) {
  test(`selecting ${name} narrows the table to the PRs opened in it`, async ({ page }) => {
    await open(page);
    if (choose !== null) {
      const before = await headline(page);
      await page.getByRole('group', { name: 'Period' }).getByRole('button', { name: choose, exact: true }).click();
      await expect(countsChart(page)).not.toHaveAccessibleDescription(before);
    }
    const table = prTable(page);
    await table.scrollIntoViewIfNeeded();
    const all = await tableCount(page);

    // A reader picks a tall bar: the bucket with the most PRs opened, as each
    // bucket's accessible name counts them.
    const buckets = countsChart(page).getByRole('group').getByRole('button');
    const opened = await buckets.evaluateAll((els) =>
      els.map((el) => Number(/\bopened ([\d,]+)/.exec(el.getAttribute('aria-label') ?? '')?.[1]?.replaceAll(',', '') ?? -1)),
    );
    expect(opened.length).toBeGreaterThan(1);
    const peak = opened.indexOf(Math.max(...opened));
    const bucket = buckets.nth(peak);
    await bucket.click();
    await expect(bucket).toHaveAttribute('aria-pressed', 'true');
    await expect(page).toHaveURL(/[#&?]week=\d{4}-\d{2}-\d{2}(&|$)/);

    await expect(table.getByRole('status')).toContainText(status);
    const narrowed = await tableCount(page);
    expect(narrowed).toBe(opened[peak]);
    expect(narrowed).toBeGreaterThan(0);
    expect(narrowed).toBeLessThan(all);
    await expect(table.getByRole('table')).toHaveAttribute('aria-rowcount', String(narrowed + 1));
  });
}

test('dragging across a chart zooms the period to that range, and Back returns to the whole history', async ({ page }) => {
  await open(page);
  const period = page.getByRole('group', { name: 'Period' });
  const from = period.getByLabel('From');
  const to = period.getByLabel('To');
  const first = (await from.getAttribute('min')) ?? '';
  const last = (await to.getAttribute('max')) ?? '';
  await expect(from).toHaveValue(first);
  await expect(to).toHaveValue(last);
  const plot = countsChart(page).locator('svg[role="group"]');
  const ticks = () => plot.locator('.axis-x text').allTextContents();
  const whole = await ticks();

  // From about 60% to about 80% of the plot's width, across its middle.
  await plot.scrollIntoViewIfNeeded();
  const box = (await plot.boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * 0.6, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.7, y, { steps: 4 });
  await page.mouse.move(box.x + box.width * 0.8, y, { steps: 4 });
  await page.mouse.up();

  await expect(page).toHaveURL(/[#&?]from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}(&|$)/);
  const start = await from.inputValue();
  const end = await to.inputValue();
  expect(start > first && start < end && end < last, `${start} to ${end}, inside ${first} to ${last}`).toBe(true);
  // The axis now runs over the range: its first tick moves, and every year it names is in the range.
  await expect.poll(async () => (await ticks())[0]).not.toBe(whole[0]);
  const years = (await ticks()).flatMap((t) => (/\d{4}/.exec(t) ?? []).map(Number));
  expect(years.length).toBeGreaterThan(0);
  for (const year of years) {
    expect(year).toBeGreaterThanOrEqual(Number(start.slice(0, 4)));
    expect(year).toBeLessThanOrEqual(Number(end.slice(0, 4)));
  }

  await page.goBack();
  await expect(page).not.toHaveURL(/[#&?](from|to)=/);
  await expect(from).toHaveValue(first);
  await expect(to).toHaveValue(last);
  await expect.poll(ticks).toEqual(whole);
});

test('opening a PR from the table shows its timeline, whose marks link to it on GitHub', async ({ page }) => {
  await open(page);
  const rows = await tableReady(page);
  const row = rows.getByRole('row').nth(1);
  const label = (await row.getByRole('link', { name: /^#\d+ on GitHub/ }).getAttribute('aria-label')) ?? '';
  const number = /^#(\d+) /.exec(label)?.[1];
  expect(number, 'the first row names its PR').toBeTruthy();

  await row.getByRole('cell').nth(1).getByRole('button').click();
  await expect(page).toHaveURL(new RegExp(`[#&?]pr=${number}(&|$)`));

  // Choosing a PR brings its section on screen, which is what loads the timeline.
  const section = page.getByRole('region', { name: `Pull request #${number}`, exact: true });
  await expect(section.getByRole('heading', { level: 2 })).toBeInViewport();
  const panel = section.getByRole('group', { name: `Selected PR #${number}`, exact: true });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('status')).toHaveCount(0);
  const timeline = section.getByRole('figure', { name: `The life of #${number}`, exact: true });
  await expect(timeline).toBeVisible();
  const marks = timeline.getByRole('group', { name: 'The marks on the line, in time order' }).getByRole('link');
  await expect(marks.first()).toBeAttached();

  // A mark links to the PR, or to a part of it by fragment or path; a merge
  // or a force-push links to the commit it made (site/src/lib/links.ts).
  const hrefs = (await marks.evaluateAll((els) => els.map((el) => el.getAttribute('href')))).filter(
    (h): h is string => h !== null,
  );
  const pull = new RegExp(`^${DATA_REPO}/pull/${number}([#/].*)?$`);
  const commit = new RegExp(`^${DATA_REPO}/commit/[0-9a-f]{40}$`);
  expect(hrefs.filter((h) => pull.test(h)).length, 'marks linking to the chosen PR').toBeGreaterThan(0);
  expect(hrefs.filter((h) => !pull.test(h) && !commit.test(h)), 'marks linking elsewhere').toEqual([]);
});

test('an address with an unknown filter value loads the defaults', async ({ page, context }) => {
  await open(page);
  const defaults = await headline(page);
  const address = page.url();

  // Loaded fresh, as a shared link is, not as a hash change on a loaded page.
  const fresh = await context.newPage();
  await open(fresh, '#/?target=no-such-target&size=no-such-size&component=no-such-component&drafts=no-such-choice');
  await expect(fresh).toHaveURL(address);
  await expect(fresh.getByRole('group', { name: 'Target' }).getByRole('radio', { name: 'main' })).toBeChecked();
  await expect(countsChart(fresh)).toHaveAccessibleDescription(defaults);
  await fresh.close();
});

/** The numbers in a column of a table, as drawn, by the column's header. */
async function columnNumbers(table: Locator, header: string): Promise<number[]> {
  return table.evaluate((el, name) => {
    const t = el as HTMLTableElement;
    const heads = Array.from(t.tHead?.rows[0]?.cells ?? []);
    const at = heads.findIndex((h) => h.querySelector('button')?.firstChild?.textContent?.trim() === name);
    if (at < 0) return [];
    return Array.from(t.tBodies[0]?.rows ?? [])
      .filter((r) => r.cells.length > at)
      .map((r) => Number((r.cells[at]?.textContent ?? '').replaceAll(',', '')));
  }, header);
}

test('sorting the Reviewers table by a count orders it, and a handle links to GitHub', async ({ page }) => {
  await open(page);
  const people = page.getByRole('region', { name: 'People', exact: true });
  await people.scrollIntoViewIfNeeded();
  const table = people.getByRole('table', { name: /^Reviewers, sorted by / });
  await expect(table.getByRole('row').nth(1)).toBeVisible();

  const header = table.getByRole('columnheader', { name: 'Comments', exact: true });
  await expect(header).toHaveAttribute('aria-sort', 'none');
  await header.getByRole('button').click();
  await expect(header).toHaveAttribute('aria-sort', 'descending');
  await expect(page).toHaveURL(/[#&?]reviewersort=-comments(&|$)/);
  const down = await columnNumbers(table, 'Comments');
  expect(down.length).toBeGreaterThan(1);
  expect(down.every((n) => Number.isFinite(n))).toBe(true);
  expect(down.some((n, i) => i > 0 && n > down[i - 1]!), `descending: ${down.join(' ')}`).toBe(false);

  await header.getByRole('button').click();
  await expect(header).toHaveAttribute('aria-sort', 'ascending');
  const up = await columnNumbers(table, 'Comments');
  expect(up.some((n, i) => i > 0 && n < up[i - 1]!), `ascending: ${up.join(' ')}`).toBe(false);
  expect(up[0]!).toBeLessThanOrEqual(down[0]!);

  // Checked for its form only: the address is not printed, so a failure names no one.
  const href = await table.getByRole('link', { name: / on GitHub, opens in a new tab$/ }).first().getAttribute('href');
  expect(USER_PAGE.test(href ?? ''), "a handle links to a GitHub user's page").toBe(true);
});

test('the methods page renders every section, its figures, and an address to a section', async ({ page, context }) => {
  await page.goto('./#/methods');
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { level: 1, name: 'Methods' })).toBeVisible();
  // The figures are computed in the browser; wait for them to settle.
  await expect(main.getByText(/^Loading the data the figures on this page are computed from/)).toHaveCount(0);
  await expect(main.getByRole('alert')).toHaveCount(0);

  // Every section the contents list is on the page under that heading, with
  // text of its own: none is a placeholder.
  const contents = main.getByRole('navigation', { name: 'Contents' }).getByRole('link');
  const titles = await contents.allTextContents();
  expect(titles.length).toBeGreaterThan(1);
  await expect(main.getByRole('heading', { level: 2 })).toHaveCount(titles.length + 1);
  for (const title of titles) {
    const section = main.getByRole('region', { name: title.trim(), exact: true });
    await expect(section.getByRole('heading', { level: 2 }), title).toHaveText(title.trim());
    await expect(section.getByRole('paragraph').or(section.getByRole('listitem')).first(), title).not.toBeEmpty();
  }
  await expect(main.getByText(/not written yet|still being (written|built)|to come\b/i)).toHaveCount(0);

  // No figure is missing or still loading, and one sentence of figures reads as numbers.
  await expect(main.getByText(/\((not available|loading)\)/)).toHaveCount(0);
  await expect(main.getByText(/could not be computed/)).toHaveCount(0);
  await expect(
    main.getByText(
      /\b[\d,]+ pull requests, on every branch, were open at some point in the last 6 months, \d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}: [\d,]+ opened in them and [\d,]+ before them\b/,
    ),
  ).toBeVisible();

  // The address the contents gives a section, loaded fresh, lands on it.
  const last = contents.last();
  const title = (await last.textContent())!.trim();
  const href = (await last.getAttribute('href')) ?? '';
  expect(href).toMatch(/[#&?]section=[\w-]+(&|$)/);
  const fresh = await context.newPage();
  await fresh.goto(`./${href}`);
  const target = fresh.getByRole('main').getByRole('region', { name: title, exact: true });
  await expect(target).toBeFocused();
  await expect(target.getByRole('heading', { level: 2 })).toBeInViewport();
  await fresh.close();
});

test('no two labels of a time axis touch, from a phone to a wide screen', async ({ page }) => {
  for (const width of [320, 1280, 1600]) {
    await page.setViewportSize({ width, height: 900 });
    await open(page);
    const gaps = await labelGaps(page.locator('body'));
    expect(gaps.length, `${width}px`).toBeGreaterThan(0);
    expect(Math.min(...gaps), `${width}px`).toBeGreaterThanOrEqual(6);
  }
});

/** The Timelines' lanes, one PR per row. */
function lanesChart(page: Page): Locator {
  return page.getByRole('figure', { name: 'Each PR’s timeline, one per row', exact: true });
}

/** The smallest space between neighbouring labels of each time axis in `scope`, as drawn. */
async function labelGaps(scope: Locator): Promise<number[]> {
  return scope.locator('svg:has(.axis-x text)').evaluateAll((svgs) =>
    svgs.map((svg) => {
      const boxes = [...svg.querySelectorAll<SVGTextElement>('.axis-x text')].map((t) => t.getBBox());
      return Math.min(Infinity, ...boxes.slice(1).map((b, i) => b.x - ((boxes[i] as DOMRect).x + (boxes[i] as DOMRect).width)));
    }),
  );
}

test('on the whole history the Timelines’ calendar covers only the stretch its PRs take up, and says so', async ({ page }) => {
  await open(page);
  const to = await page.getByRole('group', { name: 'Period' }).getByLabel('To').inputValue();
  const last = Date.parse(`${to}T00:00:00Z`);
  const figure = lanesChart(page);
  await figure.scrollIntoViewIfNeeded();
  // Every label naming a day or a month names one in the half-year before the period's last day, not 2011.
  const dated = (await figure.locator('.axis-x text').allTextContents()).filter((l) => /[A-Z][a-z]{2}/.test(l));
  expect(dated.length).toBeGreaterThan(0);
  for (const label of dated) {
    const words = label.replace(/ \d\d:\d\d$/, '').split(' ');
    const year = words.find((w) => /^\d{4}$/.test(w)) ?? to.slice(0, 4);
    const day = /^\d{1,2}$/.test(words[0]!) ? words[0]! : '1';
    const month = words.find((w) => /^[A-Z][a-z]{2}$/.test(w))!;
    let t = Date.parse(`${day} ${month} ${year} 00:00 UTC`);
    // A label without its year, after the year changed, is of the year before the last day's.
    if (!/\d{4}/.test(label) && t > last + 86_400_000) t = Date.parse(`${day} ${month} ${Number(year) - 1} 00:00 UTC`);
    expect(t, label).toBeGreaterThan(last - 183 * 86_400_000);
    expect(t, label).toBeLessThanOrEqual(last + 86_400_000);
  }
  await expect(
    figure.getByText(/^The calendar runs over the part of the period these PRs take up, \d{1,2} [A-Z][a-z]{2} \d{4}( to \d{1,2} [A-Z][a-z]{2} \d{4})?\.$/),
  ).toBeVisible();
});

test('on a one-day period the Timelines draw that day alone, marking lives that go on past it; since opening, whole lives', async ({
  page,
}) => {
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await open(page, '#/?from=2024-03-12&to=2024-03-12');
    const figure = lanesChart(page);
    await figure.scrollIntoViewIfNeeded();
    // The time axis is the section's own state, kept from the width before.
    await figure.getByRole('radio', { name: 'Calendar' }).check();
    const labels = figure.locator('.axis-x text');
    await expect(labels.first(), `${width}px`).toHaveText('12 Mar 2024');
    // The day's first moment names it; every other label is an hour of it.
    const hours = (await labels.allTextContents()).slice(1);
    expect(hours.length, `${width}px`).toBeGreaterThan(0);
    expect(hours.filter((h) => !/^\d\d:\d\d$/.test(h)), `${width}px`).toEqual([]);
    expect(Math.min(...(await labelGaps(figure))), `${width}px`).toBeGreaterThanOrEqual(6);
    // The lanes' links, each described by what is drawn of it once the list is open.
    const list = figure.locator('details');
    if ((await list.getAttribute('open')) === null) await list.locator('summary').click();
    await expect(figure.locator('ol a').first()).toHaveAccessibleDescription(/^As the calendar shows it: /);

    // Read off the canvas: where anything is drawn, and which lanes have
    // ink where a "goes on before" chevron's upper arm is, beside the left
    // edge and above the line.
    const drawn = await figure.evaluate((fig) => {
      const canvas = fig.querySelector('canvas') as HTMLCanvasElement;
      const plot = (fig.querySelector('svg.axis') as SVGSVGElement).getBoundingClientRect();
      const box = canvas.getBoundingClientRect();
      const k = canvas.width / box.width;
      const { data } = (canvas.getContext('2d') as CanvasRenderingContext2D).getImageData(0, 0, canvas.width, canvas.height);
      const inked = (x: number, y: number) => (data[(y * canvas.width + x) * 4 + 3] as number) > 0;
      let first = Infinity;
      let last = -Infinity;
      for (let x = 0; x < canvas.width; x++) {
        for (let y = 0; y < canvas.height; y++) {
          if (!inked(x, y)) continue;
          first = Math.min(first, x);
          last = Math.max(last, x + 1);
          break;
        }
      }
      const links = [...fig.querySelectorAll('ol a')];
      const n = links.length;
      const pitch = (box.height - 8) / n;
      const r = Math.max(1.5, Math.min(3.5, pitch / 2 - 0.5));
      const before = links.map((a, i) => {
        const said = document.getElementById(a.getAttribute('aria-describedby') ?? '')?.textContent ?? '';
        const y = 4 + i * pitch + pitch / 2;
        let ink = false;
        for (let x = Math.ceil((plot.left - box.left + 2) * k); x < (plot.left - box.left + 2 + r) * k; x++) {
          for (let yy = Math.floor((y - r - 0.5) * k); yy < (y - 1.2) * k; yy++) ink ||= inked(x, yy);
        }
        return { said: said.includes('its life goes on earlier than shown'), ink };
      });
      return {
        plot: { left: plot.left, right: plot.right },
        ink: { left: box.left + first / k, right: box.left + last / k },
        before,
        after: links.filter((a) => document.getElementById(a.getAttribute('aria-describedby') ?? '')?.textContent?.includes('its life goes on later than shown')).length,
      };
    });
    // Nothing of a lane is drawn outside the plot's edges.
    expect(drawn.ink.left, `${width}px`).toBeGreaterThanOrEqual(drawn.plot.left - 0.5);
    expect(drawn.ink.right, `${width}px`).toBeLessThanOrEqual(drawn.plot.right + 0.5);
    // Lives go on past the day, and every lane said to go on before it has its chevron drawn.
    expect(drawn.before.filter((b) => b.said).length, `${width}px`).toBeGreaterThan(0);
    expect(drawn.after, `${width}px`).toBeGreaterThan(0);
    expect(drawn.before.filter((b) => b.said && !b.ink), `${width}px`).toEqual([]);
    await expect(figure.getByRole('list', { name: 'Legend' }).getByText('its life goes on earlier than shown')).toBeVisible();

    // The PRs open that day span it, so the calendar is the day and says nothing more of what it covers.
    await expect(figure.getByText(/^The calendar runs over/)).toHaveCount(0);

    // Since opening, the same lanes are whole lives, and nothing says the period cuts them.
    await figure.getByRole('radio', { name: 'Days since opening' }).check();
    await expect(labels.first()).toHaveText('1 hour');
    await expect(figure).toHaveAccessibleDescription(/^The whole timelines of /);
    const lives = await figure
      .locator('ol a')
      .evaluateAll((links) => links.map((a) => document.getElementById(a.getAttribute('aria-describedby') ?? '')?.textContent ?? ''));
    expect(lives.length).toBeGreaterThan(0);
    expect(lives.filter((l) => !l.startsWith('Its whole life, from its opening: opened ') || l.includes('period'))).toEqual([]);
  }
});

/**
 * The charts drawn across the page over the period, by title, section by
 * section. Not here: the outcome curves, whose axis is a duration, the wait
 * charts set side by side with them, and the dot plot, whose dots sit at
 * their instants rather than in a bucket's column.
 */
const OVER_THE_PERIOD = [
  /^PRs opened, merged and closed unmerged, per /,
  /^Open PRs at the end of each /,
  /^Review capacity against arrivals, per /,
  /^Human and bot reviews per /,
  /^Bot commands per /,
  /^Share of PRs opened that disclose AI use, per /,
  /^Share of PRs opened naming each tool, per /,
];

test('every chart over the period has the same plot edges, down the whole page', async ({ page }) => {
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await open(page);
    const edges: { chart: string; left: number; right: number }[] = [];
    for (const name of OVER_THE_PERIOD) {
      const plots = page.getByRole('figure', { name }).locator('svg[role="group"]');
      await expect(plots.first(), `${width}px: ${name}`).toBeVisible();
      // A plot's edges: its value axis's gridlines, where the page draws them.
      const drawn = await plots.evaluateAll((svgs) =>
        svgs.map((svg) => {
          const r = (svg.querySelector('.axis-y line') as SVGLineElement).getBoundingClientRect();
          return { left: r.left, right: r.right };
        }),
      );
      drawn.forEach((e, k) => edges.push({ chart: `${name.source} #${k}`, left: Math.round(e.left), right: Math.round(e.right) }));
    }
    // The Timelines on the calendar, whose axis is the period: their plot's edges are their time axis's.
    const lanes = await lanesChart(page).locator('svg.axis').evaluate((svg) => svg.getBoundingClientRect());
    edges.push({ chart: 'Timelines', left: Math.round(lanes.left), right: Math.round(lanes.right) });
    const first = edges[0]!;
    for (const e of edges) expect(e, `${width}px`).toEqual({ ...first, chart: e.chart });
  }
});

test('the tools’ shares are one plot, with a legend entry for each tool its table lists', async ({ page }) => {
  await open(page);
  const figure = page.getByRole('figure', { name: /^Share of PRs opened naming each tool, per / });
  await expect(figure.locator('svg[role="group"]')).toHaveCount(1);
  const families = (await figure.locator('table thead th').allTextContents()).slice(1);
  expect(families.length).toBeGreaterThan(1);
  const legend = await figure.getByRole('list', { name: 'Legend' }).getByRole('listitem').allTextContents();
  expect(legend.filter((l) => !/^partial /.test(l))).toEqual(families);
  await expect(figure.locator('.plot-panel .line')).toHaveCount(families.length);
});

test('the filter bar lines its fields up, row by row, on a wide screen and a phone', async ({ page }) => {
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await open(page);
    const bar = await page.locator('.filter-bar').evaluate((el) => {
      const box = (e: Element) => e.getBoundingClientRect();
      // Each field: its label (a group's legend), and its controls.
      type Field = { name: string; label: DOMRect | null; controls: DOMRect[] };
      const fields: Field[] = [];
      // A group's controls on its legend's line are its field; those it wraps onto later lines stand alone.
      // The Period's group sits in the place it is pinned from.
      for (const fs of el.querySelectorAll(':scope > fieldset, :scope > .period-slot fieldset')) {
        const name = fs.querySelector('legend')?.textContent?.trim() ?? '';
        const controls = [...fs.querySelectorAll('input[type="date"], .presets button, .segmented')].map(box);
        const line = Math.min(...controls.map((c) => c.bottom));
        fields.push({ name, label: box(fs.querySelector('legend') as Element), controls: controls.filter((c) => c.top < line) });
        for (const c of controls.filter((c) => c.top >= line)) fields.push({ name: `${name}, wrapped`, label: null, controls: [c] });
      }
      for (const f of el.querySelectorAll(':scope > .field, .people > .field')) {
        fields.push({
          name: f.querySelector('label')?.textContent?.trim() ?? '',
          label: box(f.querySelector('label') as Element),
          controls: [box(f.querySelector('select, input') as Element)],
        });
      }
      const topOf = (f: Field) => f.label?.top ?? Math.min(...f.controls.map((c) => c.top));
      // A visual row: the fields whose spans, label to control, overlap.
      const rows: { lo: number; hi: number; fields: Field[] }[] = [];
      for (const f of fields.sort((a, b) => topOf(a) - topOf(b))) {
        const lo = topOf(f);
        const hi = Math.max(...f.controls.map((c) => c.bottom));
        const row = rows.find((r) => r.lo < hi && lo < r.hi);
        if (row) {
          row.fields.push(f);
          row.lo = Math.min(row.lo, lo);
          row.hi = Math.max(row.hi, hi);
        } else rows.push({ lo, hi, fields: [f] });
      }
      const segmented = el.querySelector('.segmented') as Element;
      const options = [...segmented.querySelectorAll('label')].map((o) => box(o).right);
      return {
        rows: rows.map((r) => ({
          names: r.fields.map((f) => f.name).join(', '),
          labels: r.fields.flatMap((f) => (f.label === null ? [] : [f.label.top])),
          tops: r.fields.flatMap((f) => f.controls.map((c) => c.top)),
          heights: r.fields.flatMap((f) => f.controls.map((c) => c.height)),
        })),
        slack: box(segmented).right - Math.max(...options),
        sideways: document.scrollingElement!.scrollWidth > window.innerWidth,
      };
    });
    const spread = (xs: number[]) => Math.max(...xs) - Math.min(...xs);
    for (const row of bar.rows) {
      if (row.labels.length > 0) expect(spread(row.labels), `${width}px, labels of ${row.names}`).toBeLessThanOrEqual(1);
      expect(spread(row.tops), `${width}px, control tops of ${row.names}`).toBeLessThanOrEqual(1);
      expect(spread(row.heights), `${width}px, control heights of ${row.names}`).toBeLessThanOrEqual(0.5);
    }
    // One control height across the bar, and a segmented control as wide as its options.
    expect(spread(bar.rows.flatMap((r) => r.heights)), `${width}px, control heights`).toBeLessThanOrEqual(0.5);
    expect(bar.slack, `${width}px, the Target control's empty slack`).toBeLessThanOrEqual(1);
    expect(bar.sideways, `${width}px, sideways scroll`).toBe(false);
  }
});

/** Scrolls the People section, the last of the report, to the top of the viewport. */
async function toPeople(page: Page): Promise<void> {
  await page.getByRole('region', { name: 'People', exact: true }).evaluate((el) => el.scrollIntoView({ block: 'start' }));
}

/**
 * Checks, with the People section scrolled to the top, that the period
 * controls and the way back to the filters are pinned within the top
 * `tallest` pixels of the viewport, one of each, every one a whole control
 * tall, and that nothing scrolls sideways.
 */
async function pinnedInView(page: Page, label: string, tallest: number): Promise<void> {
  await toPeople(page);
  const back = page.getByRole('button', { name: 'Filters', exact: true });
  await expect(back).toBeVisible();
  const height = (await banner(page).boundingBox())?.height ?? Infinity;
  expect(height, `${label}, the pinned period controls' height`).toBeLessThanOrEqual(tallest);

  const controls = {
    From: page.getByLabel('From', { exact: true }),
    To: page.getByLabel('To', { exact: true }),
    'Last 6 months': page.getByRole('button', { name: 'Last 6 months', exact: true }),
    'All, from': page.getByRole('button', { name: /^All, from / }),
    Filters: back,
  };
  for (const [name, c] of Object.entries(controls)) {
    await expect(c, `${label}, ${name}`).toHaveCount(1);
    await expect(c, `${label}, ${name}`).toBeVisible();
    const box = (await c.boundingBox())!;
    expect(box.y, `${label}, ${name}'s top`).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height, `${label}, ${name}'s bottom`).toBeLessThanOrEqual(height);
    expect(box.height, `${label}, ${name}'s height`).toBeGreaterThanOrEqual(38);
  }
  await expect(page.getByRole('group', { name: 'Period' }).getByLabel('From', { exact: true })).toHaveCount(1);
  expect(await page.evaluate(() => document.scrollingElement!.scrollWidth > window.innerWidth), `${label}, sideways scroll`).toBe(false);
}

for (const { width, tallest } of [
  { width: 1280, tallest: 52 },
  { width: 390, tallest: 96 },
]) {
  test(`at ${width}px the period controls stay at the top of the viewport down to the People section, one set of them`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await open(page);
    await pinnedInView(page, `${width}px`, tallest);

    // Changed there, the period changes the address and the figures.
    const to = page.getByLabel('To', { exact: true });
    const before = await headline(page);
    const day = `${Number(((await to.getAttribute('max')) ?? '').slice(0, 4)) - 1}-06-30`;
    await to.fill(day);
    await expect(page).toHaveURL(new RegExp(`[#&?]to=${day}(&|$)`));
    await expect(countsChart(page)).not.toHaveAccessibleDescription(before);
    await expect(to).toHaveValue(day);
    await expect(to).toBeInViewport();
  });
}

// The machine's own sans-serif is not the only one a reader's phone may have:
// a wider face must not wrap the pinned controls onto more lines.
test('at 390px in a wide typeface the pinned period controls keep to their two lines', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await open(page);
  await page.addStyleTag({ content: '* { font-family: "DejaVu Sans", Verdana, sans-serif !important; }' });
  await pinnedInView(page, '390px, a wide typeface', 96);
});

test('the page below holds still as the period controls pin and unpin', async ({ page }) => {
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await open(page);
    await page.waitForLoadState('networkidle');
    const period = page.getByRole('group', { name: 'Period' });
    const top = await period.evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
    // Where the People section is on the page, not in the viewport.
    const people = () =>
      page.getByRole('region', { name: 'People', exact: true }).evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
    const scroll = (y: number) => page.evaluate((to) => window.scrollTo(0, to), y);

    await scroll(top - 1);
    await expect.poll(() => bannerBottom(page), `${width}px, in place`).toBe(0);
    const placed = await people();
    await scroll(top + 1);
    await expect.poll(() => bannerBottom(page), `${width}px, pinned`).toBeGreaterThan(0);
    expect(await people(), `${width}px, the People section once pinned`).toBe(placed);
    await scroll(top - 1);
    await expect.poll(() => bannerBottom(page), `${width}px, in place again`).toBe(0);
    expect(await people(), `${width}px, the People section once back in place`).toBe(placed);
  }
});

test('Filters, on the pinned period controls, brings the filter bar back into view and focuses it', async ({ page }) => {
  await open(page);
  await toPeople(page);
  const back = page.getByRole('button', { name: 'Filters', exact: true });
  await back.click();
  const bar = page.getByRole('region', { name: 'Filters', exact: true });
  await expect(bar).toBeFocused();
  await expect(bar).toBeInViewport();
  await expect(back).toHaveCount(0);
});

test('the footer shows a version and the repository link', async ({ page }) => {
  await open(page);
  const footer = page.getByRole('contentinfo');
  await footer.scrollIntoViewIfNeeded();
  await expect(footer.getByRole('link', { name: REPO.replace(/^https:\/\//, ''), exact: true })).toHaveAttribute('href', REPO);
  // A released build links its version to that release's page; a local build may be `dev`.
  const version = footer.getByRole('link', { name: /^v\d+\.\d+\.\d+$/ });
  if (process.env['CEPHSTATS_E2E_URL']) {
    await expect(version, 'a published site shows its release').toBeVisible();
  } else {
    await expect(footer).toContainText(/(^|\s)(dev|v\d+\.\d+\.\d+)(\s|$)/);
  }
  if ((await version.count()) > 0) {
    await expect(version).toHaveAttribute('href', `${REPO}/releases/tag/${(await version.textContent())!.trim()}`);
  }
});
