// Local development acceptance; uses the parent website's existing Playwright dependency.
const { chromium } = require('../../../node_modules/playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
(async () => {
  const prefix = process.env.QPCR_FIXTURE_PREFIX;
  if (!prefix) throw new Error('Set QPCR_FIXTURE_PREFIX');
  const output = path.resolve(__dirname, '../test-results'); await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage(), errors = [], remote = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', r => { if (!/^https?:\/\/127\.0\.0\.1:5178|^blob:|^data:/.test(r.url())) remote.push(r.url()); });
    const ready = () => page.waitForFunction(() => !document.querySelector('fieldset').disabled);
    const nav = name => page.getByRole('navigation', { name: '实验工作流' }).getByRole('link', { name, exact: true }).click();
    const snap = name => page.screenshot({ path: path.join(output, 'ui-' + name + '.png'), fullPage: true });
    await page.goto('http://127.0.0.1:5178/');
    await ready();
    assert.equal(await page.getByRole('navigation', { name: '实验工作流' }).getByRole('link').count(), 8);
    await nav('数据导入');
    await page.locator('input[accept=".eds,.xlsx"]').setInputFiles([prefix + '.eds', prefix + '.xlsx']);
    try { await page.getByRole('status').filter({ hasText: '交叉验证通过' }).waitFor({ timeout: 60000 }); }
    catch(e) { console.log(await page.locator('body').innerText()); console.log({ errors, remote }); await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }); throw e; }
    await page.waitForFunction(() => !document.querySelector('fieldset').disabled);
    assert.equal(await page.getByRole('alert').count(), 0);
    assert.ok((await page.locator('.key-values').innerText()).includes('90 有效孔'));
    await snap('04-import');
    await page.reload(); await ready();
    assert.ok((await page.locator('.key-values').innerText()).includes('12 / 8'));
    await nav('实验信息');
    await page.locator('.dna-banner img').evaluate(img => img.decode());
    await snap('01-experiment');
    await nav('定量分析');
    await page.getByLabel('内参（可多选）').selectOption(['h-ACTIN']);
    await page.waitForFunction(() => !document.querySelector('fieldset').disabled);
    await page.getByLabel('或单个校准样本').selectOption('1xAC16-NC-3');
    await page.waitForFunction(() => !document.querySelector('fieldset').disabled);
    await page.getByRole('checkbox').click();
    await page.waitForFunction(() => !document.querySelector('fieldset').disabled);
    assert.equal(await page.getByRole('checkbox').isChecked(), true);
    assert.equal(await page.getByRole('alert').count(), 0);
    assert.ok(await page.locator('.fold-plot circle').count());
    await snap('06-quant');
    await nav('统计与图表');
    assert.ok(await page.locator('.fold-plot circle').count());
    await snap('07-statistics');
    for (const [label, extension] of [['导出 SVG', '.svg'], ['导出 Excel', '.xlsx']]) {
      const pending = page.waitForEvent('download');
      await page.getByRole('button', { name: label, exact: true }).click();
      const result = await pending;
      assert.ok(result.suggestedFilename().endsWith(extension));
      await ready();
    }
    await nav('质量控制');
    await snap('05-qc');
    await page.getByRole('button', { name: '扩增曲线', exact: true }).click();
    assert.equal(await page.locator('.chart-svg').count(), 1);
    await page.getByRole('button', { name: '熔解曲线', exact: true }).click();
    assert.equal(await page.locator('.chart-svg').count(), 2);
    await nav('孔板设计');
    assert.equal(await page.locator('.plate button').count(), 96);
    await page.locator('.plate button').first().click();
    assert.equal(await page.locator('.plate button').first().getAttribute('aria-pressed'), 'true');
    await snap('03-plate');
    await nav('实验准备');
    const concentration = page.getByLabel(/RNA 浓度$/).first();
    await concentration.fill('500');
    await concentration.press('Enter');
    await ready();
    assert.ok((await concentration.locator('xpath=ancestor::tr').innerText()).includes('正常'));
    await snap('02-prep');
    await page.getByRole('button', { name: '高级参数', exact: true }).click();
    await page.getByRole('button', { name: '读取当前参数' }).click();
    const c = JSON.parse(await page.getByLabel('高级参数 JSON').inputValue()); c.pcr.sybr = 8;
    await page.getByLabel('高级参数 JSON').fill(JSON.stringify(c)); await page.getByRole('button', { name: '应用参数', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('fieldset').disabled);
    await page.getByRole('button', { name: 'Master Mix', exact: true }).click();
    assert.ok((await page.getByRole('heading', { name: 'Master Mix · 随孔板更新' }).locator('..').innerText()).includes('15.5'));
    const dlPromise = page.waitForEvent('download'); await page.getByRole('button', { name: '导出完整项目', exact: true }).click();
    const dl = await dlPromise, backup = path.join(output, 'roundtrip.qpcrproj'); await dl.saveAs(backup);
    console.log('browser: backup downloaded');
    await page.waitForFunction(() => !document.querySelector('fieldset').disabled);
    await page.getByRole('button', { name: '新建项目', exact: true }).click();
    console.log('browser: new project clicked');
    await page.waitForFunction(() => !document.querySelector('fieldset').disabled);
    await page.locator('input[accept=".qpcrproj"]').setInputFiles(backup);
    console.log('browser: restore input selected');
    try { await page.getByRole('status').filter({ hasText: '已恢复为独立副本' }).waitFor({ timeout: 30000 }); }
    catch(e) { console.log(await page.locator('body').innerText()); throw e; }
    await nav('数据导入');
    assert.ok((await page.locator('.key-values').innerText()).includes('90 有效孔'));
    await nav('日志与版本');
    assert.ok(await page.locator('details').count() > 5);
    await snap('08-history');
    await page.setViewportSize({ width: 390, height: 844 });
    for (const name of ['实验信息', '实验准备', '孔板设计', '数据导入', '质量控制', '定量分析', '统计与图表', '日志与版本']) {
      await nav(name);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, name + ' has page-level horizontal overflow');
    }
    await nav('孔板设计');
    await snap('mobile-plate');
    assert.deepEqual(errors, []); assert.deepEqual(remote, []);
    console.log(JSON.stringify({ passed: true, workflow: ['all-eight-pages', 'real-pair-import', 'refresh', 'reference-calibrator', 'chart-exports', 'curves', 'plate', 'rna-mix-update', 'backup-restore', 'history', 'mobile-layout'], remoteRequests: remote, pageErrors: errors }));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
