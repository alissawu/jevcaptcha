import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.connectOverCDP('https://showman-handshake-unselfish.ngrok-free.dev');
  const contexts = browser.contexts();
  const page = contexts[0]?.pages()[0];
  if (!page) { console.log('No page'); return; }
  
  // Click verify to open captcha
  const verifyBtn = page.locator('[class*="geetest_btn_click"]').first();
  await verifyBtn.click();
  await page.waitForTimeout(2000);
  
  // Get background element
  const bgEl = page.locator('[class*="geetest_bg"]').first();
  const bgBox = await bgEl.boundingBox();
  console.log('Background element:', bgBox);
  
  // Get slice element
  const sliceEl = page.locator('[class*="geetest_slice_bg"]').first();
  const sliceBox = await sliceEl.boundingBox();
  console.log('Slice element:', sliceBox);
  
  // Get slider track
  const track = page.locator('[class*="geetest_slider"]').first();
  const trackBox = await track.boundingBox();
  console.log('Slider track:', trackBox);
  
  // Get slider button
  const sliderBtn = page.locator('[class*="geetest_btn"]:not([class*="click"])').first();
  const sliderBox = await sliderBtn.boundingBox();
  console.log('Slider button:', sliderBox);
  
  // Calculate positions
  if (bgBox && sliceBox && sliderBox) {
    console.log('\n--- Analysis ---');
    console.log('BG image width:', bgBox.width);
    console.log('Slice starts at page x:', sliceBox.x);
    console.log('Slice offset from BG:', sliceBox.x - bgBox.x);
    console.log('Slider starts at page x:', sliderBox.x);
    console.log('Slider offset from BG:', sliderBox.x + sliderBox.width/2 - bgBox.x);
  }
  
  await page.close();
}
main();
