/**
 * Capture a captcha from reCAPTCHA demo for testing
 */

import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

async function captureRecaptcha() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  // Google reCAPTCHA demo
  await page.goto('https://www.google.com/recaptcha/api2/demo', { waitUntil: 'networkidle' });
  
  // Click the checkbox
  const frame = page.frameLocator('iframe[title="reCAPTCHA"]');
  await frame.locator('.recaptcha-checkbox-border').click();
  
  // Wait for challenge
  await page.waitForTimeout(3000);
  
  // Find challenge iframe (it's a new iframe that appears)
  const challengeFrame = page.frameLocator('iframe[title*="recaptcha challenge"]');
  
  // Get the prompt
  const promptEl = challengeFrame.locator('.rc-imageselect-desc-wrapper');
  const prompt = await promptEl.textContent().catch(() => 'Unknown');
  console.log('Prompt:', prompt?.trim().replace(/\s+/g, ' '));
  
  // Screenshot the image grid
  const grid = challengeFrame.locator('.rc-imageselect-target');
  await grid.waitFor({ timeout: 10000 }).catch(() => {});
  
  const gridBox = await grid.boundingBox().catch(() => null);
  
  if (gridBox && gridBox.width > 100) {
    const screenshot = await page.screenshot({
      clip: { x: gridBox.x, y: gridBox.y, width: gridBox.width, height: gridBox.height },
    });
    const outPath = path.join(import.meta.dirname, 'fixtures', 'recaptcha_grid.png');
    fs.writeFileSync(outPath, screenshot);
    console.log(`Saved: ${outPath} (${Math.round(gridBox.width)}x${Math.round(gridBox.height)})`);
  } else {
    // Full page fallback
    const screenshot = await page.screenshot({ fullPage: true });
    const outPath = path.join(import.meta.dirname, 'fixtures', 'recaptcha_full.png');
    fs.writeFileSync(outPath, screenshot);
    console.log(`Saved full page: ${outPath}`);
  }
  
  await browser.close();
}

captureRecaptcha().catch(console.error);
