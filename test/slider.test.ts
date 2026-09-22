/**
 * Test slider solver against GeeTest demo
 */

import { chromium } from 'playwright';

async function testGeeTest() {
  console.log('=== GeeTest Slide CAPTCHA Test ===\n');
  
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  try {
    await page.goto('https://www.geetest.com/en/adaptive-captcha-demo');
    await page.waitForTimeout(2000);
    
    // Click "Slide CAPTCHA" tab
    console.log('Clicking Slide CAPTCHA tab...');
    await page.locator('text=Slide CAPTCHA').click();
    await page.waitForTimeout(1000);
    
    // Click "Click to verify"
    console.log('Clicking verify button...');
    await page.locator('text=Click to verify').click();
    await page.waitForTimeout(2000);
    
    // Screenshot to see the slider
    await page.screenshot({ path: '/home/kit/jevcaptcha/test/geetest-slider.png', fullPage: true });
    console.log('Screenshot saved: geetest-slider.png');
    
    // Look for slider elements
    const sliderFrame = page.frameLocator('iframe').first();
    const slider = page.locator('.geetest_slider_button, [class*="slider"], [class*="drag"]');
    const sliderCount = await slider.count();
    console.log('Slider elements found:', sliderCount);
    
    // Get all class names that might be slider-related
    const classes = await page.evaluate(() => {
      const elements = document.querySelectorAll('*');
      const sliderClasses: string[] = [];
      elements.forEach(el => {
        if (el.className && typeof el.className === 'string') {
          if (el.className.includes('slider') || el.className.includes('drag') || el.className.includes('geetest')) {
            sliderClasses.push(el.className);
          }
        }
      });
      return [...new Set(sliderClasses)];
    });
    console.log('Slider-related classes:', classes.slice(0, 10));
    
  } catch (e: any) {
    console.log('Error:', e.message);
    await page.screenshot({ path: '/home/kit/jevcaptcha/test/geetest-error.png' });
  }
  
  await browser.close();
}

testGeeTest().catch(console.error);
