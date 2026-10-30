import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { CREDS_FILE } from './paths.ts';

const creds = () => JSON.parse(readFileSync(CREDS_FILE, 'utf8')) as { username: string; password: string };

// 64x40 solid maroon PNG, built in-memory.
function pngBytes(): Buffer {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAEAAAAAoCAIAAADBrGu+AAAAT0lEQVR4nO3PAQkAAAyEwI++6IshgnABdLep8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyD2JiwBM6rVntAAAAABJRU5ErkJggg==',
    'base64',
  );
}

async function login(page: Page) {
  const { username, password } = creds();
  await page.goto('/admin/login');
  await hydrated(page);
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/admin\/blogs/);
  await hydrated(page);
}

/** Islands render on the server first; wait until React has taken over. */
async function hydrated(page: Page) {
  await page.waitForFunction(() => document.querySelectorAll('astro-island[ssr]').length === 0, null, { timeout: 30_000 });
}

const editorReady = (page: Page) =>
  expect(page.getByRole('textbox', { name: 'Article content' })).toBeVisible({ timeout: 30_000 });

async function seriousViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  return results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.nodes.length} node(s) — ${v.nodes[0]?.target.join(' ')}`);
}

test.describe.configure({ mode: 'serial' });

test('admin area requires sign-in and rejects a wrong password', async ({ page }) => {
  await page.goto('/admin/blogs');
  await expect(page).toHaveURL(/\/admin\/login\?next=/);
  await hydrated(page);
  await page.getByLabel('Username').fill(creds().username);
  await page.getByLabel('Password', { exact: true }).fill('definitely-not-the-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toContainText('Incorrect username or password');
  await page.getByRole('button', { name: 'Show password' }).click();
  await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'text');
});

test('write, autosave, reload, preview and publish an article', async ({ page, context }) => {
  await login(page);
  await page.getByRole('button', { name: /Create New Blog/ }).first().click();
  await expect(page).toHaveURL(/\/admin\/blogs\/[0-9a-f-]{36}$/);
  await editorReady(page);
  const editorUrl = page.url();

  await page.getByLabel('Title', { exact: true }).fill('Five Phrases That Defuse Workplace Tension');
  await page.getByLabel('Subtitle or excerpt').fill('Practical language for calmer, clearer conversations.');

  const body = page.getByRole('textbox', { name: 'Article content' });
  await body.click();
  await page.keyboard.type('Why words matter');
  await page.getByLabel('Text style').selectOption('h2');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('When tension rises, ');
  await page.keyboard.press('Control+B');
  await page.keyboard.type('specific language');
  await page.keyboard.press('Control+B');
  await page.keyboard.type(' lowers the temperature.');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Bulleted list' }).click();
  await page.keyboard.type('Name the feeling');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Ask a curious question');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');

  // Link via the dialog
  await page.keyboard.type('Read more');
  await page.keyboard.press('Shift+Home');
  await page.getByRole('button', { name: 'Link' }).click();
  await page.getByLabel('Link address').fill('example.com/guide');
  await page.getByRole('button', { name: 'Add link' }).click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');

  // Table
  await page.getByRole('button', { name: 'Insert table' }).click();
  await page.keyboard.type('Phrase');
  await expect(page.getByRole('group', { name: 'Table options' })).toBeVisible();

  // Image upload through the media picker
  await page.getByRole('button', { name: 'Insert image' }).click();
  const dialog = page.getByRole('dialog', { name: 'Insert image' });
  await dialog.locator('input[type=file]').setInputFiles({ name: 'workshop.png', mimeType: 'image/png', buffer: pngBytes() });
  await dialog.getByLabel('Alt text', { exact: true }).fill('Participants in a workshop');
  await dialog.getByRole('button', { name: 'Use this image' }).click();
  await expect(body.locator('figure[data-type="image"] img')).toHaveAttribute('alt', 'Participants in a workshop');

  // Sidebar: category and tag (the sidebar is visible at desktop width)
  await page.getByPlaceholder('New category').fill('Communication');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Communication' })).toBeChecked();
  await page.getByLabel('Add tags').fill('Conflict');
  await page.keyboard.press('Enter');

  // Autosave confirms with the server
  await expect(page.getByRole('status').filter({ hasText: /Saved|All changes saved/ }).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByLabel('Slug', { exact: true })).toHaveValue('five-phrases-that-defuse-workplace-tension');

  // Reload: everything persisted
  await page.reload();
  await editorReady(page);
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Five Phrases That Defuse Workplace Tension');
  await expect(body.locator('h2')).toHaveText('Why words matter');
  await expect(body.locator('strong')).toHaveText('specific language');
  await expect(body.locator('ul li')).toHaveCount(2);
  await expect(body.locator('a')).toHaveAttribute('href', 'https://example.com/guide');
  await expect(body.locator('table')).toBeVisible();

  // Draft is not public
  const anon = await context.browser()!.newContext();
  const anonPage = await anon.newPage();
  const draftRes = await anonPage.goto('/blogs/five-phrases-that-defuse-workplace-tension');
  expect(draftRes?.status()).toBe(404);

  // Preview uses the public article layout
  const [preview] = await Promise.all([page.waitForEvent('popup'), page.getByRole('button', { name: 'Preview' }).click()]);
  await preview.waitForURL(/\/admin\/preview\//);
  await expect(preview.getByRole('heading', { level: 1 })).toHaveText('Five Phrases That Defuse Workplace Tension');
  await expect(preview.getByText(/Only you can see this page/)).toBeVisible();
  await preview.close();

  // Publish
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByText('Published! Your article is live.')).toBeVisible();

  // Public reader
  await anonPage.goto('/blogs');
  await expect(anonPage.getByRole('link', { name: /Five Phrases That Defuse Workplace Tension/ })).toBeVisible();
  await anonPage.getByRole('link', { name: /Five Phrases That Defuse Workplace Tension/ }).click();
  await expect(anonPage.getByRole('heading', { level: 1 })).toHaveText('Five Phrases That Defuse Workplace Tension');
  const article = anonPage.locator('.prose');
  await expect(article.locator('h2')).toHaveText('Why words matter');
  await expect(article.locator('a[href="https://example.com/guide"]')).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(article.locator('img')).toHaveAttribute('alt', 'Participants in a workshop');
  await expect(article.locator('table')).toBeVisible();
  await expect(anonPage.locator('link[rel=canonical]')).toHaveAttribute('href', /\/blogs\/five-phrases-that-defuse-workplace-tension$/);
  await expect(anonPage.locator('meta[property="og:type"]')).toHaveAttribute('content', 'article');
  const ld = await anonPage.locator('script[type="application/ld+json"]').first().textContent();
  expect(JSON.parse(ld!)[0]['@type']).toBe('BlogPosting');

  // Search and category filter
  await anonPage.goto('/blogs?q=temperature');
  await expect(anonPage.getByRole('link', { name: /Five Phrases/ })).toBeVisible();
  await anonPage.goto('/blogs?q=zzznomatch');
  await expect(anonPage.getByText(/No articles match/)).toBeVisible();
  await anonPage.goto('/blogs?category=communication');
  await expect(anonPage.getByRole('link', { name: /Five Phrases/ })).toBeVisible();

  // Edit while live: readers see the old version until Update
  await page.goto(editorUrl);
  await editorReady(page);
  await page.getByLabel('Subtitle or excerpt').fill('An updated summary for readers.');
  await expect(page.getByText(/Readers still see the published version/)).toBeVisible({ timeout: 20_000 });
  await anonPage.goto('/blogs/five-phrases-that-defuse-workplace-tension');
  await expect(anonPage.locator('.dek')).toHaveText('Practical language for calmer, clearer conversations.');
  await page.getByRole('button', { name: 'Update', exact: true }).click();
  await expect(page.getByText('Live article updated.')).toBeVisible();
  await anonPage.reload();
  await expect(anonPage.locator('.dek')).toHaveText('An updated summary for readers.');

  // Unsaved-change protection on leaving
  await page.getByLabel('Title', { exact: true }).fill('Five Phrases That Defuse Workplace Tension!');
  const dialogPromise = page.waitForEvent('dialog');
  void page.close({ runBeforeUnload: true });
  const leave = await dialogPromise;
  expect(leave.type()).toBe('beforeunload');
  await leave.dismiss();
  await anon.close();
});

test('unpublish removes the article from the public site', async ({ page, context }) => {
  await login(page);
  await page.getByRole('button', { name: 'Unpublish' }).first().click();
  await expect(page.getByText(/was unpublished/)).toBeVisible();
  const anon = await context.browser()!.newContext();
  const res = await (await anon.newPage()).goto('/blogs/five-phrases-that-defuse-workplace-tension');
  expect(res?.status()).toBe(404);
  await anon.close();
});

test('key pages have no serious accessibility violations', async ({ page }) => {
  await page.goto('/blogs');
  expect(await seriousViolations(page)).toEqual([]);
  await page.goto('/admin/login');
  expect(await seriousViolations(page)).toEqual([]);
  await login(page);
  expect(await seriousViolations(page)).toEqual([]);
});
