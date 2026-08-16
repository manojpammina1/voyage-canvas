import { expect, test, type APIRequestContext } from '@playwright/test';

const HERO_INTENT =
  '7-night Caribbean cruise in March 2027 for 2 adults and 2 kids, balcony, under $5,000';

async function expectInfraHealthy(request: APIRequestContext) {
  const health = await request.get('/api/health');
  expect(health.ok()).toBe(true);
  await expect(health).toBeOK();
}

test('hero search creates a signed checkout handoff', async ({ page, request }) => {
  await expectInfraHealthy(request);

  await page.goto('/');
  await expect(page.locator('main[data-voyage-ready="true"]')).toBeVisible();
  await page.getByLabel('Trip description').fill(HERO_INTENT);
  await page.getByRole('button', { name: 'Explore voyages' }).click();

  await expect(page.getByText(/voyage possibilities verified/i)).toBeVisible();
  await expect(page.getByText('Verified total')).toBeVisible();
  await expect(page.getByText('Commitment')).toBeVisible();

  await page.getByRole('button', { name: 'Simulate sign in' }).click();
  await expect(page.getByText(/session rotated/i)).toBeVisible();

  await page.getByLabel(/I confirm I want to hold this cabin/i).check();
  await page.getByRole('button', { name: 'Create short-lived hold' }).click();
  await expect(page.getByText(/Hold active until/i)).toBeVisible();

  await page.getByRole('button', { name: 'Continue to secure checkout' }).click();
  await expect(page).toHaveURL(/\/existing-checkout\?bc=/);
  await expect(
    page.getByRole('heading', { name: 'Secure checkout handoff received' }),
  ).toBeVisible();
  await expect(page.getByText('Signature')).toBeVisible();
  await expect(page.getByText('Valid')).toBeVisible();
});
