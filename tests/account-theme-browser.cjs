const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');

(async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:1000},colorScheme:'dark'});
  const page=await context.newPage(),errors=[],checks=[];
  page.on('pageerror',error=>errors.push(error.message));
  // Theme checks use no accounts or database calls.
  await context.route('https://**/*',route=>route.abort());
  const palette=()=>page.locator('body').evaluate(el=>getComputedStyle(el).getPropertyValue('--bg').trim());
  try{
    await page.goto('http://127.0.0.1:8765/account/?theme=light&next=%2Ftools%2Fsop-timeline%2F#test');
    await page.getByRole('button',{name:'切换到深色模式'}).waitFor();
    assert.equal(await palette(),'#f7f5f2');checks.push('explicit light mode overrides dark system preference');
    await page.getByRole('button',{name:'切换到深色模式'}).click();
    assert.equal(await palette(),'#16171a');
    assert.equal(await page.evaluate(()=>localStorage.getItem('theme')),'dark');
    assert.equal(new URL(page.url()).searchParams.get('next'),'/tools/sop-timeline/');
    assert.equal(new URL(page.url()).hash,'#test');checks.push('toggle updates palette, saved choice, and URL without losing return path');
    await page.reload();await page.getByRole('button',{name:'切换到浅色模式'}).waitFor();
    assert.equal(await palette(),'#16171a');checks.push('refresh retains choice even with theme in incoming URL');
    await page.getByRole('button',{name:'切换到浅色模式'}).press('Enter');
    assert.equal(await palette(),'#f7f5f2');checks.push('keyboard toggle restores light mode');
    await page.goto('http://127.0.0.1:8765/account/');
    await page.getByRole('button',{name:'切换到深色模式'}).waitFor();
    assert.equal(await palette(),'#f7f5f2');checks.push('new visit restores stored choice');
    await page.setViewportSize({width:390,height:844});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.getByRole('button',{name:'切换到深色模式'}).click();
    // Inspect signed-in layout presentation only; this is not an authentication test.
    await page.evaluate(()=>{document.querySelector('#signedOut').hidden=true;document.querySelector('#signedIn').hidden=false;document.body.classList.add('is-signed-in');});
    assert.equal(await palette(),'#16171a');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await fs.mkdir('.local/screenshots',{recursive:true});
    await page.screenshot({path:'.local/screenshots/account-theme-mobile.png',fullPage:true});
    checks.push('mobile login and account layouts keep the theme button visible without overflow');
    const blocked=await browser.newContext();
    await blocked.route('https://**/*',route=>route.abort());
    await blocked.addInitScript(()=>{Storage.prototype.setItem=()=>{throw new DOMException('Storage blocked','SecurityError');};Storage.prototype.getItem=()=>{throw new DOMException('Storage blocked','SecurityError');};});
    const other=await blocked.newPage();
    await other.goto('http://127.0.0.1:8765/account/');
    await other.getByRole('button',{name:'切换到浅色模式'}).click();
    assert.equal(await other.locator('body').evaluate(el=>getComputedStyle(el).getPropertyValue('--bg').trim()),'#f7f5f2');
    await blocked.close();checks.push('switch works for current visit when browser storage is blocked');
    await page.goto('http://127.0.0.1:8765/?theme=light');
    await page.getByRole('button',{name:'切换到深色模式'}).click();
    assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
    assert.equal(await page.locator('#theme-btn').textContent(),'☀️');
    checks.push('homepage theme control retains its existing icon and switching behavior');
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({passed:checks.length,checks}));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
