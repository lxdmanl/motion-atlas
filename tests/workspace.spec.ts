import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const screenshotDirectory = resolve('output/playwright/workspace');
const missingKeyMessage = '請在本機 .env.local 設定 OPENAI_API_KEY 並重新啟動伺服器。攝影機與 3D 功能可繼續使用。';

async function readyScene(page: Page) {
  const scene = page.getByTestId('anatomy-canvas');
  await expect(scene).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
  await expect(page.getByRole('img', { name: '可旋轉與選取的 3D 解剖模型' })).toBeVisible();
  const webgl = await scene.locator('canvas').evaluate((canvas: HTMLCanvasElement) => {
    const context = canvas.getContext('webgl2') || canvas.getContext('webgl');
    return { available: !!context, lost: context?.isContextLost(), width: context?.drawingBufferWidth ?? 0, height: context?.drawingBufferHeight ?? 0 };
  });
  expect(webgl.available).toBe(true);
  expect(webgl.lost).toBe(false);
  expect(webgl.width).toBeGreaterThan(300);
  expect(webgl.height).toBeGreaterThan(300);
  return scene;
}

async function expectAngle(page: Page, expected: number) {
  await expect.poll(async () => Math.abs(Number(await page.getByTestId('anatomy-canvas').getAttribute('data-angle')) - expected),
    { timeout: 12_000, message: `Rendered elbow angle should settle at ${expected}°` }).toBeLessThan(1.5);
}

async function screenshot(page: Page, name: string) {
  await mkdir(screenshotDirectory, { recursive: true });
  await page.screenshot({ path: resolve(screenshotDirectory, `${name}.png`), fullPage: true, animations: 'disabled' });
}

test.setTimeout(90_000);

test('real 3D scene responds to the demo slider and clears measured angle after demo ends', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await readyScene(page);
  await expect(page.locator('.angle-number')).toHaveText('—°');
  await page.getByRole('button', { name: '右手臂', exact: true }).click();
  await page.getByRole('button', { name: '展示模式', exact: true }).click();
  await expect(page.getByText('示範資料 · 非相機', { exact: true })).toBeVisible();
  const slider = page.getByRole('slider', { name: '示範屈肘角度' });
  await slider.press('Home');
  await expectAngle(page, 0);
  await slider.press('End');
  for (let index = 0; index < 20; index++) await slider.press('ArrowLeft');
  await expect(slider).toHaveValue('110');
  await expectAngle(page, 110);
  await expect(page.locator('.angle-number')).toHaveText('110°');
  await screenshot(page, 'demo-right-arm-110');
  await page.getByRole('button', { name: '展示模式', exact: true }).click();
  await expect(slider).toHaveCount(0);
  await expect(page.locator('.angle-number')).toHaveText('—°');
  await expect(page.getByText('尚無量測', { exact: true })).toBeVisible();
  await expectAngle(page, 0);
  expect(errors).toEqual([]);
});

test('focus, layers, anatomical selection and view reset work together', async ({ page }) => {
  await page.goto('/');
  await readyScene(page);
  const rail = page.getByRole('navigation', { name: '模型工具' });
  await rail.getByRole('button', { name: '右手臂', exact: true }).click();
  await expect(rail.getByRole('button', { name: '右手臂', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('右手臂 · 探索肘關節的屈與伸', { exact: true })).toBeVisible();
  await rail.getByRole('button', { name: '肌肉', exact: true }).click();
  await expect(rail.getByRole('button', { name: '肌肉', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await screenshot(page, 'arm-bones-layer');
  const biceps = page.getByRole('button', { name: /肱二頭肌 Biceps brachii/ });
  await biceps.click();
  await expect(biceps).toHaveAttribute('aria-pressed', 'true');
  await expect(rail.getByRole('button', { name: '肌肉', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('heading', { name: '肱二頭肌', exact: true })).toBeVisible();
  await rail.getByRole('button', { name: '肌腱示意', exact: true }).click();
  await expect(rail.getByRole('button', { name: '肌腱示意', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '側面', exact: true }).click();
  await expect(page.getByRole('button', { name: '側面', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await screenshot(page, 'arm-biceps-selected-side');
  await page.getByRole('button', { name: '重設視角', exact: true }).click();
  await expect(rail.getByRole('button', { name: '全身', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(rail.getByRole('button', { name: '肌腱示意', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect(biceps).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('button', { name: '3D', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

for (const viewport of [{ width: 1366, height: 768 }, { width: 1920, height: 1080 }]) {
  test(`desktop ${viewport.width}×${viewport.height} renders without page overflow`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await readyScene(page);
    const layout = await page.evaluate(() => ({
      width: window.innerWidth, height: window.innerHeight,
      scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight,
      panels: ['.topbar', '.rail', '.stage', '.inspector', '.voice-dock'].map(selector => {
        const rect = document.querySelector(selector)!.getBoundingClientRect();
        return { selector, left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
      }),
    }));
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.width);
    expect(layout.scrollHeight).toBeLessThanOrEqual(layout.height);
    for (const panel of layout.panels) {
      expect(panel.left, panel.selector).toBeGreaterThanOrEqual(-1);
      expect(panel.top, panel.selector).toBeGreaterThanOrEqual(-1);
      expect(panel.right, panel.selector).toBeLessThanOrEqual(layout.width + 1);
      expect(panel.bottom, panel.selector).toBeLessThanOrEqual(layout.height + 1);
    }
    await screenshot(page, `workspace-${viewport.width}x${viewport.height}`);
  });
}

test('missing API key leaves 3D usable and displays voice/text setup errors', async ({ page }) => {
  let explainCalls = 0;
  await page.route('**/api/health', route => route.fulfill({ json: { ok: true, apiKeyConfigured: false } }));
  await page.route('**/api/explain', route => { explainCalls++; return route.fulfill({ status: 503, json: { error: { code: 'missing_api_key', message: missingKeyMessage } } }); });
  await page.goto('/');
  await readyScene(page);
  await expect(page.getByText('等待 API Key', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '開始語音', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('OPENAI_API_KEY');
  await page.getByRole('button', { name: '關閉提示', exact: true }).click();
  await page.getByRole('button', { name: '文字提問', exact: true }).click();
  await page.getByRole('textbox', { name: '你的問題' }).fill('目前屈肘可能用到哪些肌肉？');
  await page.getByRole('button', { name: '送出問題', exact: true }).click();
  await expect(page.locator('.text-answer')).toHaveText(missingKeyMessage);
  expect(explainCalls).toBe(1);
  await page.getByRole('button', { name: '關閉對話框', exact: true }).click();
  await expect(page.getByTestId('anatomy-canvas')).toHaveAttribute('data-ready', 'true');
});

test('a failed GLB download shows retry and recovers to the real 3D scene', async ({ page }) => {
  let failModel = true;
  let intercepted = 0;
  await page.route('**/models/*.glb', route => {
    if (failModel) { intercepted++; return route.fulfill({ status: 503, contentType: 'text/plain', body: 'Intentional model load failure for browser test' }); }
    return route.continue();
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: '重新載入', exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('alert')).toBeVisible();
  expect(intercepted).toBeGreaterThan(0);
  await screenshot(page, 'model-load-failure');
  failModel = false;
  await page.getByRole('button', { name: '重新載入', exact: true }).click();
  await readyScene(page);
  await expect(page.getByRole('button', { name: '重新載入', exact: true })).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
});
