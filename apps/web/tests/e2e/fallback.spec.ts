import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test';

const HERO_INTENT =
  '7-night Caribbean cruise in March 2027 for 2 adults and 2 kids, balcony, under $5,000';

async function expectInfraHealthy(request: APIRequestContext) {
  const health = await request.get('/api/health');
  expect(health.ok()).toBe(true);
}

async function submitHeroIntent(page: Page) {
  await page.goto('/');
  await expect(page.locator('main[data-voyage-ready="true"]')).toBeVisible();
  await page.getByLabel('Trip description').fill(HERO_INTENT);
  await page.getByRole('button', { name: 'Explore voyages' }).click();
  await expect(page.getByText(/voyage possibilities verified/i)).toBeVisible();
}

test('model outage fallback preserves criteria and deterministic search', async ({
  page,
  request,
}) => {
  await expectInfraHealthy(request);
  await submitHeroIntent(page);

  await page.getByRole('button', { name: 'AI outage demo' }).click();

  await expect(
    page.getByRole('heading', { name: 'Guided voyage planner' }),
  ).toBeVisible();
  await expect(
    page.getByText(/AI assistance is temporarily unavailable/i),
  ).toBeVisible();
  await expect(page.getByText('2027-03')).toBeVisible();

  await page.getByRole('button', { name: 'Search again with saved criteria' }).click();
  await expect(page.getByText(/voyage possibilities verified/i)).toBeVisible();
  await expect(page.getByText('Verified total')).toBeVisible();
});
