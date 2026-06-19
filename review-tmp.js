const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE_URL = 'https://wm.filipeandrade.com';
const SCREENSHOTS_DIR = '/tmp/wm-review/screenshots';

async function screenshot(page, name) {
  const filePath = path.join(SCREENSHOTS_DIR, `${name}.png`);
  await page.screenshot({ path: filePath, fullPage: false });
  console.log(`SCREENSHOT: ${name} -> ${filePath}`);
  return filePath;
}

async function fullScreenshot(page, name) {
  const filePath = path.join(SCREENSHOTS_DIR, `${name}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  console.log(`SCREENSHOT: ${name} -> ${filePath}`);
  return filePath;
}

async function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const results = { errors: [], findings: [] };

  // ── Phase 0: mobile viewport (390px)
  console.log('\n=== PHASE 0: Mobile 390px ===');
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  const page = await mobile.newPage();

  // Capture console errors
  const consoleErrors = [];
  const consoleWarnings = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
    if (msg.type() === 'warning') consoleWarnings.push(msg.text());
  });
  page.on('pageerror', err => consoleErrors.push(`PAGE ERROR: ${err.message}`));

  // ── Landing (Highlights tab)
  console.log('Navigating to main page...');
  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await delay(2000);
  await screenshot(page, '01-mobile-highlights-landing');

  // Check version
  const versionResp = await page.evaluate(async () => {
    try {
      const r = await fetch('/api/version');
      return await r.json();
    } catch(e) { return { error: e.message }; }
  });
  console.log('VERSION:', JSON.stringify(versionResp));

  // ── Highlights feed detail
  await delay(1000);
  await screenshot(page, '02-mobile-highlights-feed');

  // Try scrolling in the highlights feed
  await page.evaluate(() => {
    const feed = document.querySelector('#highlights-feed, .highlights-feed, [class*="feed"], [class*="reel"]');
    if (feed) feed.scrollBy(0, 300);
  });
  await delay(500);
  await screenshot(page, '03-mobile-highlights-scrolled');

  // ── Drawer test
  console.log('Testing drawer...');
  const drawerBtn = await page.$('[aria-label*="Menü"], [aria-label*="menu"], [aria-label*="drawer"], .drawer-toggle, #drawer-toggle, button[class*="drawer"], button[class*="menu"], .hamburger');
  if (drawerBtn) {
    await drawerBtn.click();
    await delay(500);
    await screenshot(page, '04-mobile-drawer-open');
    // Close drawer
    await page.keyboard.press('Escape');
    await delay(300);
  } else {
    console.log('FINDING: Drawer button not found by aria-label — trying left side buttons');
    // Try to find any button in top-left area
    const buttons = await page.$$('button');
    console.log(`Found ${buttons.length} buttons total`);
    for (const btn of buttons.slice(0, 5)) {
      const text = await btn.innerText().catch(() => '');
      const ariaLabel = await btn.getAttribute('aria-label').catch(() => '');
      const className = await btn.getAttribute('class').catch(() => '');
      console.log(`Button: text="${text}" aria="${ariaLabel}" class="${className}"`);
    }
    await screenshot(page, '04-mobile-drawer-attempt');
  }

  // ── Navigate to Spiele tab
  console.log('Navigating to Spiele tab...');
  const spieleTab = await page.$('[data-tab="spiele"], button:has-text("Spiele"), a:has-text("Spiele"), [aria-label*="Spiele"]');
  if (spieleTab) {
    await spieleTab.click();
    await delay(2000);
    await screenshot(page, '05-mobile-spiele-landing');
    await fullScreenshot(page, '06-mobile-spiele-full');
  } else {
    // Try clicking by text
    await page.evaluate(() => {
      const tabs = document.querySelectorAll('[data-tab], button, a');
      for (const t of tabs) {
        if (t.textContent && t.textContent.trim().includes('Spiele')) {
          t.click();
          return;
        }
      }
    });
    await delay(2000);
    await screenshot(page, '05-mobile-spiele-fallback');
  }

  // ── Inspect Spiele tab DOM
  const spieleInfo = await page.evaluate(() => {
    const view = document.querySelector('#view-spiele, [data-view="spiele"]');
    if (!view) return { found: false };
    const groups = view.querySelectorAll('.group-accordion, [class*="group"]');
    const matches = view.querySelectorAll('.match-card, [class*="match"]');
    const scores = view.querySelectorAll('.score, [class*="score"]');
    return {
      found: true,
      visible: !view.hidden && getComputedStyle(view).display !== 'none',
      groups: groups.length,
      matches: matches.length,
      scores: scores.length,
      innerHTML_snippet: view.innerHTML.substring(0, 500)
    };
  });
  console.log('SPIELE INFO:', JSON.stringify(spieleInfo, null, 2));

  // ── Mehr tab
  console.log('Navigating to Mehr tab...');
  await page.evaluate(() => {
    const tabs = document.querySelectorAll('[data-tab], button, a, [role="tab"]');
    for (const t of tabs) {
      if (t.textContent && t.textContent.trim().match(/^Mehr$/)) {
        t.click();
        return;
      }
    }
  });
  await delay(1500);
  await screenshot(page, '07-mobile-mehr-landing');

  // ── Torjägerliste sub-view
  console.log('Testing Torjägerliste...');
  await page.evaluate(() => {
    const items = document.querySelectorAll('a, button, [role="button"]');
    for (const item of items) {
      if (item.textContent && item.textContent.includes('Torjäger')) {
        item.click();
        return;
      }
    }
  });
  await delay(2000);
  await screenshot(page, '08-mobile-torjaeger');
  await fullScreenshot(page, '08b-mobile-torjaeger-full');

  // ── Back to Mehr
  await page.evaluate(() => {
    const back = document.querySelector('[aria-label*="zurück"], [aria-label*="back"], .back-button, button[class*="back"]');
    if (back) back.click();
    else window.history.back();
  });
  await delay(1000);

  // ── Tabellen sub-view
  console.log('Testing Tabellen...');
  await page.evaluate(() => {
    const items = document.querySelectorAll('a, button, [role="button"]');
    for (const item of items) {
      if (item.textContent && item.textContent.includes('Tabellen')) {
        item.click();
        return;
      }
    }
  });
  await delay(2000);
  await screenshot(page, '09-mobile-tabellen');

  // ── K.o.-Baum sub-view
  console.log('Testing K.o.-Baum...');
  await page.evaluate(() => {
    const back = document.querySelector('[aria-label*="zurück"], [aria-label*="back"], .back-button, .mehr-back');
    if (back) back.click();
  });
  await delay(500);
  await page.evaluate(() => {
    const items = document.querySelectorAll('a, button, [role="button"]');
    for (const item of items) {
      if (item.textContent && (item.textContent.includes('K.-o') || item.textContent.includes('Bracket') || item.textContent.includes('K.o'))) {
        item.click();
        return;
      }
    }
  });
  await delay(2000);
  await screenshot(page, '10-mobile-ko-baum');

  // ── Aufstellungen sub-view
  console.log('Testing Aufstellungen...');
  await page.evaluate(() => {
    const back = document.querySelector('[aria-label*="zurück"], [aria-label*="back"], .back-button, .mehr-back');
    if (back) back.click();
  });
  await delay(500);
  await page.evaluate(() => {
    const items = document.querySelectorAll('a, button, [role="button"]');
    for (const item of items) {
      if (item.textContent && item.textContent.includes('Aufstellung')) {
        item.click();
        return;
      }
    }
  });
  await delay(2000);
  await screenshot(page, '11-mobile-aufstellungen');

  // ── Kader sub-view
  console.log('Testing Kader...');
  await page.evaluate(() => {
    const back = document.querySelector('[aria-label*="zurück"], [aria-label*="back"], .back-button, .mehr-back');
    if (back) back.click();
  });
  await delay(500);
  await page.evaluate(() => {
    const items = document.querySelectorAll('a, button, [role="button"]');
    for (const item of items) {
      if (item.textContent && item.textContent.includes('Kader')) {
        item.click();
        return;
      }
    }
  });
  await delay(2000);
  await screenshot(page, '12-mobile-kader');

  // ── Full DOM inspection
  const domInfo = await page.evaluate(() => {
    // Gather all tabs
    const tabs = Array.from(document.querySelectorAll('[data-tab], [role="tab"], .tab-btn, .tab-button'))
      .map(t => ({ text: t.textContent?.trim(), tag: t.tagName, classes: t.className, aria: t.getAttribute('aria-label') }));

    // Gather all nav items
    const navItems = Array.from(document.querySelectorAll('nav *'))
      .filter(el => el.children.length === 0)
      .map(el => el.textContent?.trim())
      .filter(Boolean);

    return { tabs, navItems, title: document.title };
  });
  console.log('DOM INFO:', JSON.stringify(domInfo, null, 2));

  // Console errors report
  console.log('\n=== CONSOLE ERRORS ===');
  consoleErrors.forEach(e => console.log('ERROR:', e));
  consoleWarnings.forEach(w => console.log('WARN:', w));

  await mobile.close();
  await browser.close();
  console.log('\n=== DONE ===');
}

main().catch(console.error);
