'use strict';

const assert = require('node:assert/strict');
const { chmod, mkdtemp, readFile, readdir, rm, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const test = require('node:test');

/**
 * 等待被测 HTTP 服务真正开始监听，避免用固定延时造成偶发失败。
 *
 * @param {string} url - 用于探测服务是否就绪的完整 URL。
 * @param {number} attempts - 最多允许探测的次数。
 * @returns {Promise<void>} 服务可访问时完成；超过次数仍不可访问时抛出异常。
 * @throws {Error} 当服务始终没有在限定次数内启动时抛出。
 */
async function waitForServer(url, attempts = 80) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // 服务进程刚启动时连接失败是预期状态，短暂等待后继续探测。
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`测试服务未能启动：${url}`);
}

/**
 * 轮询直到断言条件成立，专门用于等待后台发布队列完成。
 *
 * @param {() => Promise<*>} read - 每轮读取当前状态的异步函数。
 * @param {(value:*) => boolean} predicate - 返回 true 表示等待完成的判断函数。
 * @param {number} [attempts=80] - 最大轮询次数。
 * @returns {Promise<*>} 第一个满足条件的状态快照。
 * @throws {Error} 超过次数仍未满足条件时抛出异常。
 */
async function waitForCondition(read, predicate, attempts = 80) {
  let latest = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    latest = await read();
    if (predicate(latest)) return latest;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  throw new Error(`等待后台状态超时：${JSON.stringify(latest)}`);
}

test('shop-summary 将页面字段转换成 Workctl 的 kebab-case 参数', async t => {
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'workctl-dashboard-test-'));
  const fakeWorkctl = path.join(temporaryDirectory, 'fake-workctl.js');
  const port = 20000 + (process.pid % 10000);

  // 假 Workctl 只替代外部 CLI：真实的 HTTP 路由、查询参数解析和参数构造代码仍被执行。
  await writeFile(fakeWorkctl, `#!/usr/bin/env node
'use strict';
process.stdout.write(JSON.stringify({
  success: true,
  data: { args: process.argv.slice(2) },
  meta: { source: 'test-double' }
}));
`);
  await chmod(fakeWorkctl, 0o700);

  const serverProcess = spawn(process.execPath, [path.resolve(__dirname, '..', 'server.js')], {
    env: {
      ...process.env,
      PORT: String(port),
      WORKCTL_BIN: fakeWorkctl,
    },
    stdio: 'ignore',
  });

  // 测试结束时只清理本测试创建的子进程和临时目录，不影响正在运行的 8787 服务。
  t.after(async () => {
    serverProcess.kill('SIGTERM');
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  await waitForServer(`http://127.0.0.1:${port}/api/endpoints`);
  const response = await fetch(
    `http://127.0.0.1:${port}/api/q/shop-summary?` +
    'startDate=2026-08-01&endDate=2026-08-31&statisticsType=day&__nocache=1'
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body.data.args, [
    'icbu',
    'advisor',
    'data-advisor-shop-summary',
    '--start-date',
    '2026-08-01',
    '--end-date',
    '2026-08-31',
    '--statistics-type',
    'day',
    '--format',
    'json',
    '--compact-output',
    'off',
  ]);
});

test('/api/health 通过真实后端边界检查 Workctl 且不返回凭据', async t => {
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'workctl-health-test-'));
  const fakeWorkctl = path.join(temporaryDirectory, 'fake-workctl.js');
  const port = 30000 + (process.pid % 10000);

  // 只替代外部 Workctl 进程，HTTP 路由、子进程执行和响应过滤均使用生产代码。
  await writeFile(fakeWorkctl, `#!/usr/bin/env node
'use strict';
process.stdout.write(JSON.stringify({
  success: true,
  data: { status: 'attached' },
  meta: { source: 'test-double' }
}));
`);
  await chmod(fakeWorkctl, 0o700);

  const serverProcess = spawn(process.execPath, [path.resolve(__dirname, '..', 'server.js')], {
    env: {
      ...process.env,
      ACCIO_GATEWAY_TOKEN: 'must-not-be-returned',
      PORT: String(port),
      WORKCTL_BIN: fakeWorkctl,
    },
    stdio: 'ignore',
  });

  t.after(async () => {
    serverProcess.kill('SIGTERM');
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  await waitForServer(`http://127.0.0.1:${port}/api/endpoints`);
  const response = await fetch(`http://127.0.0.1:${port}/api/health`);

  // 先断言路由存在；旧实现会在这里以 404 明确失败，而不会误报 JSON 解析错误。
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body, {
    ok: true,
    service: 'ready',
    workctl: { reachable: true, authenticated: true },
    endpointCount: 36,
  });
  assert.equal(JSON.stringify(body).includes('must-not-be-returned'), false);
});

test('产品发布支持单品草稿、批量串行发布和请求幂等', async t => {
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'workctl-publish-test-'));
  const fakeWorkctl = path.join(temporaryDirectory, 'fake-workctl.js');
  const eventLog = path.join(temporaryDirectory, 'events.log');
  const port = 41000 + (process.pid % 5000);

  // 假 Workctl 会读取服务端生成的临时 JSON 文件，并记录开始/结束顺序。
  // 这样测试覆盖真实 HTTP、图片上传、参考商品、publish-from-json 和串行 worker，
  // 只替代远端店铺读取与写入，不绕过本项目的服务端边界。
  await writeFile(fakeWorkctl, `#!/usr/bin/env node
'use strict';
const fs = require('fs');
const args = process.argv.slice(2);
if (args.includes('list-user-category')) {
  process.stdout.write(JSON.stringify({
    success: true,
    data: [{ categoryId: 201276606, categoryName: 'Smart Watch' }]
  }));
  process.exit(0);
}
if (args.includes('data-advisor-shop-product')) {
  process.stdout.write(JSON.stringify({
    success: true,
    data: { data: [{ id: 1600009001, subject: 'Existing Account Watch', categoryId: 201276606, priceUnit: 4 }], recordCount: 1 }
  }));
  process.exit(0);
}
if (args.includes('query-template-info-by-id')) {
  const productId = args[args.indexOf('--productId') + 1];
  const workDirectory = args[args.indexOf('--work_dir') + 1];
  const templateDirectory = require('path').join(workDirectory, 'template');
  fs.mkdirSync(templateDirectory, { recursive: true });
  fs.writeFileSync(require('path').join(templateDirectory, 'ref_' + productId + '.json'), JSON.stringify({
    categoryId: 201276606,
    title: 'Imported Reference Watch',
    texts: ['AMOLED wholesale display', 'OEM packaging available', 'Stable sample lead time']
  }));
  process.stdout.write(JSON.stringify({ success: true, data: { status: 'done' } }));
  process.exit(0);
}
const fileIndex = args.indexOf('--json-file');
if (fileIndex >= 0) {
  const params = JSON.parse(fs.readFileSync(args[fileIndex + 1], 'utf8'));
  if (args.includes('list-information')) {
    // 图片图库、参考商品参数与计价/物流选项复用同一个 WorkCTL 命令，但请求组件不同。
    // 这里按 componentList 返回对应真实形态，验证服务端不会把现有商品参数丢掉。
    if (Array.isArray(params.componentList) && params.componentList.includes('images')) {
      process.stdout.write(JSON.stringify({
        success: true,
        data: JSON.stringify({
          basicInfo: { images: [
            { imageIndex: 0, originalImageUrl: 'https://cdn.example.com/main-1.jpg' },
            { imageIndex: 1, originalImageUrl: 'https://cdn.example.com/main-2.jpg' }
          ] },
          detail: { detailImage: [
            { imageIndex: 0, imageSetId: 'detail-set-1', originalImageUrl: 'https://cdn.example.com/detail-1.jpg' }
          ] },
          trade: { salePropDataSource: [{ options: [
            { attrValue: 'Red', imgUrl: 'https://cdn.example.com/sku-red.jpg' }
          ] }] }
        })
      }));
      process.exit(0);
    }
    if (Array.isArray(params.componentList) && params.componentList.includes('attr')) {
      process.stdout.write(JSON.stringify({
        success: true,
        data: JSON.stringify({
          categoryId: 201276606,
          basicInfo: {
            productTitle: 'Imported Reference Watch',
            productKeywords: 'smart watch\\nhealth watch',
            attr: [{ attrNameId: 2, attrName: 'Applicable People', attrValueId: 22, attrValue: 'Unisex' }]
          },
          trade: {
            saleType: 'normal', moq: 10, inventory: 280, priceUnit: 4,
            ladderPrices: [{ ladderIndex: 0, minQuantity: 10, unitPrice: 25.85 }]
          },
          fulfillment: {
            ladderPeriod: [{ ladderIndex: 0, quantity: 500, period: 5 }],
            pkgLength: 17.1, pkgWidth: 9.6, pkgHeight: 6.3, pkgWeight: 0.133,
            logisticsProperty: ['general_cargo_0'], shippingTemplateId: 4001
          },
          detail: { productSellingPoint: 'AMOLED display\\nECG detection' }
        })
      }));
      process.exit(0);
    }
    process.stdout.write(JSON.stringify({
      success: true,
      data: JSON.stringify({
        trade: { priceUnit: 4 },
        fulfillment: { shippingTemplateId: 4001 }
      })
    }));
    process.exit(0);
  }
  if (args.includes('list-attribute-options')) {
    process.stdout.write(JSON.stringify({
      success: true,
      data: JSON.stringify([{ attrNameId: 2, attrName: 'Applicable People', options: [
        { attrValueId: 22, attrValue: 'Unisex', custom: false }
      ] }])
    }));
    process.exit(0);
  }
  if (args.includes('list-attribute')) {
    process.stdout.write(JSON.stringify({
      success: true,
      data: JSON.stringify([
        { attrNameId: 1, attrName: 'Place of Origin', required: true, multiSelect: false, enumProp: false, inputProp: true },
        { attrNameId: 2, attrName: 'Applicable People', required: true, multiSelect: false, enumProp: true, inputProp: false }
      ])
    }));
    process.exit(0);
  }
  if (args.includes('upload-file')) {
    if (params.bucket_name !== 'test-image-bucket' || !params.is_base64 || !params.file_content) {
      process.stdout.write(JSON.stringify({ success: false, error: { message: 'invalid upload params' } }));
      process.exit(0);
    }
    process.stdout.write(JSON.stringify({
      success: true,
      data: JSON.stringify({ url: 'https://cdn.example.com/' + params.filename, bucket: params.bucket_name })
    }));
    process.exit(0);
  }
}
const inputIndex = args.indexOf('--input');
if (inputIndex < 0 || !args.includes('publish-from-json')) {
  process.stdout.write(JSON.stringify({ success: true, data: { status: 'attached' } }));
  process.exit(0);
}
const material = JSON.parse(fs.readFileSync(args[inputIndex + 1], 'utf8'));
const publishType = args[args.indexOf('--publish_type') + 1];
if (material.materialVersion || !material.basicInfo || !material.trade || !material.fulfillment || !material.detail ||
    !material.basicInfo.images?.[0]?.newImageUrl || !material.basicInfo.attr?.[0]?.attrValue ||
    typeof material.trade.ladderPrices?.[0]?.unitPrice !== 'number' ||
    (publishType === 'product' &&
      (material.trade.priceUnit !== 4 || material.fulfillment.shippingTemplateId !== 4001))) {
  process.stdout.write(JSON.stringify({ success: false, error: { message: 'invalid platform material shape' } }));
  process.exit(0);
}
const title = material.basicInfo.productTitle;
fs.appendFileSync(${JSON.stringify(eventLog)}, 'start:' + publishType + ':' + title + '\\n');
const until = Date.now() + 35;
while (Date.now() < until) {}
fs.appendFileSync(${JSON.stringify(eventLog)}, 'end:' + publishType + ':' + title + '\\n');
if (title === 'Fail Product') {
  process.stdout.write(JSON.stringify({
    success: true,
    data: {
      succeeded: 0,
      failed: 1,
      results: [{
        success: false,
        errorCode: 'INVALID_LADDER_PRICE',
        error: 'ladderPrice unitPrice is required',
        itemJsonPath: '/private/tmp/product_failed.json'
      }]
    }
  }));
  process.exit(0);
}
process.stdout.write(JSON.stringify({
  success: true,
  data: {
    succeeded: 1,
    failed: 0,
    results: [{
      success: true,
      productId: title === 'Product A' ? 101 : 102,
      finalScore: title === 'Product B' ? 86 : 93,
      lowScore: false,
      deductReasons: title === 'Product B' ? ['主图清晰度仍可提升'] : [],
      qualityScoreMessage: title === 'Product B' ? '建议继续优化主图' : '质量良好'
    }]
  }
}));
`);
  await chmod(fakeWorkctl, 0o700);

  const serverProcess = spawn(process.execPath, [path.resolve(__dirname, '..', 'server.js')], {
    env: {
      ...process.env,
      PORT: String(port),
      WORKCTL_BIN: fakeWorkctl,
      PUBLISH_IMAGE_BUCKET: 'test-image-bucket',
      ACCIO_ACTIVE_SPACE: 'test-account_212003',
      PUBLISH_IMAGE_LIBRARY_CACHE_DIR: path.join(temporaryDirectory, 'image-library-cache'),
      PUBLISH_SUBMISSION_INTERVAL_MS: '5',
    },
    stdio: 'ignore',
  });
  t.after(async () => {
    serverProcess.kill('SIGTERM');
    await rm(temporaryDirectory, { recursive: true, force: true });
  });
  await waitForServer(`http://127.0.0.1:${port}/api/endpoints`);

  // 发品页必须从当前账号实时取得叶子类目和属性，而不是依赖前端四个演示类目。
  const categoryResponse = await fetch(`http://127.0.0.1:${port}/api/publish/categories?q=watch`);
  const categoryBody = await categoryResponse.json();
  assert.equal(categoryResponse.status, 200);
  assert.deepEqual(categoryBody.categories, [
    { id: 201276606, name: 'Smart Watch', path: 'Smart Watch' },
  ]);
  const schemaResponse = await fetch(`http://127.0.0.1:${port}/api/publish/category-schema?categoryId=201276606`);
  const schemaBody = await schemaResponse.json();
  assert.equal(schemaResponse.status, 200);
  assert.equal(schemaBody.schema.source, 'workctl-live');
  assert.equal(schemaBody.schema.attributes[0].attrNameId, 1);

  // 发品页先从当前账号已有商品取得 categoryId，再用该内部值请求上面的 Schema。
  // 对浏览器只返回表单匹配必需的脱敏字段，不泄露商品 ID 和负责人信息。
  const accountContextResponse = await fetch(`http://127.0.0.1:${port}/api/publish/account-context?limit=8`);
  const accountContextBody = await accountContextResponse.json();
  assert.equal(accountContextResponse.status, 200);
  assert.equal(accountContextBody.context.defaultCategory.categoryId, 201276606);
  assert.equal(accountContextBody.context.products[0].categoryId, 201276606);
  assert.match(accountContextBody.context.products[0].referenceKey, /^[0-9a-f-]{36}$/i);
  assert.equal(JSON.stringify(accountContextBody).includes('1600009001'), false);

  // 首屏返回后，全店历史图库在后台补齐并持续汇报进度。公开状态只包含汇总数字，
  // 不暴露真实商品号、账号 scope 或本机缓存路径。
  const imageLibraryStatus = await waitForCondition(async () => {
    const response = await fetch(`http://127.0.0.1:${port}/api/publish/image-library/status`);
    const body = await response.json();
    return body.library;
  }, library => ['ready', 'partial'].includes(library?.status));
  assert.equal(imageLibraryStatus.status, 'ready');
  assert.equal(imageLibraryStatus.totalProducts, 1);
  assert.equal(imageLibraryStatus.processedProducts, 1);
  assert.equal(imageLibraryStatus.availableProducts, 1);
  assert.equal(imageLibraryStatus.imageCount, 4);
  assert.equal(JSON.stringify(imageLibraryStatus).includes('1600009001'), false);

  // 浏览器仍然只提交随机 referenceKey；服务端从持久缓存返回按用途分组的旧图。
  const accountImagesResponse = await fetch(`http://127.0.0.1:${port}/api/publish/account-images`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ referenceKey: accountContextBody.context.products[0].referenceKey }),
  });
  const accountImagesBody = await accountImagesResponse.json();
  assert.equal(accountImagesResponse.status, 200);
  assert.deepEqual(accountImagesBody.images.primary, [
    'https://cdn.example.com/main-1.jpg',
    'https://cdn.example.com/main-2.jpg',
  ]);
  assert.deepEqual(accountImagesBody.images.sku, ['https://cdn.example.com/sku-red.jpg']);
  assert.deepEqual(accountImagesBody.images.detail, ['https://cdn.example.com/detail-1.jpg']);
  assert.equal(JSON.stringify(accountImagesBody).includes('1600009001'), false);

  // 缓存必须真的落在服务端磁盘，而不是仅存在当前 Node 进程内。文件名以账号哈希隔离，
  // 内容保留内部商品号供下次启动关联，但该文件从不经公开 API 返回浏览器。
  const cacheDirectory = path.join(temporaryDirectory, 'image-library-cache');
  const cacheFiles = await readdir(cacheDirectory);
  assert.equal(cacheFiles.length, 1);
  assert.match(cacheFiles[0], /^publish-image-library-[0-9a-f]+\.json$/);
  const persistedLibrary = JSON.parse(await readFile(path.join(cacheDirectory, cacheFiles[0]), 'utf8'));
  assert.equal(persistedLibrary.version, 1);
  assert.equal(persistedLibrary.records.length, 1);
  assert.equal(persistedLibrary.records[0].primary.length, 2);
  assert.equal(persistedLibrary.records[0].sku.length, 1);
  assert.equal(persistedLibrary.records[0].detail.length, 1);

  // 选择店铺已有商品时，浏览器只回传随机 referenceKey。服务端内部才把它还原为
  // productId 并执行模板查询，响应仍然不会泄露真实商品号。
  const accountReferenceResponse = await fetch(`http://127.0.0.1:${port}/api/publish/account-reference`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ referenceKey: accountContextBody.context.products[0].referenceKey }),
  });
  const accountReferenceBody = await accountReferenceResponse.json();
  assert.equal(accountReferenceResponse.status, 200);
  assert.equal(accountReferenceBody.reference.title, 'Imported Reference Watch');
  assert.equal(accountReferenceBody.reference.images.total, 4);
  assert.deepEqual(accountReferenceBody.reference.attributes, [
    { attrNameId: 2, attrName: 'Applicable People', attrValueId: 22, attrValue: 'Unisex' },
  ]);
  assert.deepEqual(accountReferenceBody.reference.keywords, ['smart watch', 'health watch']);
  assert.deepEqual(accountReferenceBody.reference.trade, {
    saleType: 'normal',
    batchNum: null,
    moq: 10,
    inventory: 280,
    priceUnit: 4,
    ladderPrices: [{ minQuantity: 10, unitPrice: 25.85 }],
  });
  assert.deepEqual(accountReferenceBody.reference.fulfillment, {
    ladderPeriod: [{ quantity: 500, period: 5 }],
    pkgLength: 17.1,
    pkgWidth: 9.6,
    pkgHeight: 6.3,
    pkgWeight: 0.133,
    logisticsProperty: ['general_cargo_0'],
    shippingTemplateId: 4001,
  });
  assert.deepEqual(accountReferenceBody.reference.sellingPoints, ['AMOLED display', 'ECG detection']);
  assert.equal(JSON.stringify(accountReferenceBody).includes('1600009001'), false);

  // 页面只消费业务名称，但服务端必须从当前账号商品自动读取真实内部编码。
  const businessOptionsResponse = await fetch(`http://127.0.0.1:${port}/api/publish/business-options`);
  const businessOptionsBody = await businessOptionsResponse.json();
  assert.equal(businessOptionsResponse.status, 200);
  assert.deepEqual(businessOptionsBody.options.priceUnits[0], {
    value: 4,
    label: '件 / 个',
    usageCount: 2,
  });
  assert.deepEqual(businessOptionsBody.options.shippingTemplates[0], {
    value: 4001,
    label: '店铺常用运费方案',
    usageCount: 1,
  });

  // 浏览器只需要知道图片能力是否可用；bucket 等管理员参数绝不能返回。
  const uploadCapabilityResponse = await fetch(`http://127.0.0.1:${port}/api/publish/upload-capability`);
  const uploadCapabilityBody = await uploadCapabilityResponse.json();
  assert.equal(uploadCapabilityResponse.status, 200);
  assert.equal(uploadCapabilityBody.configured, true);
  assert.equal(JSON.stringify(uploadCapabilityBody).includes('test-image-bucket'), false);

  // 图片正文由服务端完成格式校验，再交给 WorkCTL；浏览器只收到远程地址。
  const uploadResponse = await fetch(`http://127.0.0.1:${port}/api/publish/images`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filename: 'watch.png',
      contentType: 'image/png',
      base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    }),
  });
  const uploadBody = await uploadResponse.json();
  assert.equal(uploadResponse.status, 201);
  assert.equal(uploadBody.image.url, 'https://cdn.example.com/watch.png');
  assert.equal(JSON.stringify(uploadBody).includes('test-image-bucket'), false);

  // 普通用户只粘贴参考商品链接；商品号由服务端解析，响应只保留可编辑内容。
  const referenceResponse = await fetch(`http://127.0.0.1:${port}/api/publish/reference`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reference: 'https://www.alibaba.com/product-detail/Smart-Watch_1601234567890.html' }),
  });
  const referenceBody = await referenceResponse.json();
  assert.equal(referenceResponse.status, 200);
  assert.equal(referenceBody.reference.categoryId, 201276606);
  assert.equal(referenceBody.reference.title, 'Imported Reference Watch');
  assert.equal(JSON.stringify(referenceBody).includes('1601234567890'), false);

  const makeProduct = (localId, title) => ({
    localId,
    title,
    categoryId: 201276606,
    categoryName: '消费电子 > 可穿戴设备 > 智能手表',
    images: Array.from({ length: 5 }, (_, index) => `https://example.com/${localId}-${index}.jpg`),
    keywords: ['AMOLED', 'GPS'],
    attributes: [
      { attrNameId: 1, attrName: 'Place of Origin', attrValueId: -1, attrValue: 'China' },
      { attrNameId: 2, attrName: 'Applicable People', attrValueId: 22, attrValue: 'Unisex' },
    ],
    sellingPoints: ['Point 1', 'Point 2', 'Point 3', 'Point 4', 'Point 5'],
    trade: {
      saleType: 'normal',
      moq: 10,
      inventory: 100,
      priceUnitId: 4,
      priceUnitLabel: '件 / 个',
      ladderPrices: [{ minQuantity: 10, unitPrice: 9.9 }],
    },
    fulfillment: {
      ladderPeriod: [{ quantity: 100, period: 7 }],
      logisticsProperty: ['battery_0_0'],
      package: { length: 10, width: 8, height: 6, weight: 0.2 },
      shippingTemplateId: 4001,
      shippingTemplateLabel: 'Test template',
    },
  });

  const unconfirmed = await fetch(`http://127.0.0.1:${port}/api/publish/enqueue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'draft', scope: 'single', products: [makeProduct('a', 'Product A')] }),
  });
  assert.equal(unconfirmed.status, 400);

  const wrongEnumProduct = makeProduct('bad-enum', 'Wrong enum');
  wrongEnumProduct.attributes[1].attrValueId = -1;
  const wrongEnumResponse = await fetch(`http://127.0.0.1:${port}/api/publish/enqueue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'draft',
      scope: 'single',
      confirmed: true,
      acknowledgement: 'I_CONFIRM_PRODUCT_WRITE',
      idempotencyKey: 'integration-invalid-enum-0001',
      products: [wrongEnumProduct],
    }),
  });
  assert.equal(wrongEnumResponse.status, 400);
  assert.match((await wrongEnumResponse.json()).error, /官方 attrValueId/);

  const missingPlatformIds = makeProduct('missing-ids', 'Missing platform IDs');
  delete missingPlatformIds.trade.priceUnitId;
  delete missingPlatformIds.fulfillment.shippingTemplateId;
  const missingPlatformIdsResponse = await fetch(`http://127.0.0.1:${port}/api/publish/enqueue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'publish',
      scope: 'single',
      confirmed: true,
      acknowledgement: 'I_CONFIRM_PRODUCT_WRITE',
      idempotencyKey: 'integration-missing-platform-ids-0001',
      products: [missingPlatformIds],
    }),
  });
  assert.equal(missingPlatformIdsResponse.status, 202);
  const missingPlatformIdsBody = await missingPlatformIdsResponse.json();
  assert.equal(missingPlatformIdsBody.jobs[0].status, 'queued');

  const batchRequest = {
    action: 'publish',
    scope: 'batch',
    confirmed: true,
    acknowledgement: 'I_CONFIRM_PRODUCT_WRITE',
    idempotencyKey: 'integration-batch-publish-0001',
    products: [makeProduct('a', 'Product A'), makeProduct('b', 'Product B')],
  };
  const batchResponse = await fetch(`http://127.0.0.1:${port}/api/publish/enqueue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(batchRequest),
  });
  assert.equal(batchResponse.status, 202);
  const batchBody = await batchResponse.json();
  assert.equal(batchBody.jobs.length, 2);
  assert.equal(batchBody.operation.total, 2);
  assert.equal(batchBody.operation.id, batchBody.jobs[0].operationId);
  assert.deepEqual(batchBody.jobs.map(job => job.position), [1, 2]);
  assert.ok(batchBody.jobs.every(job => job.total === 2));
  assert.ok(batchBody.jobs.every(job => job.operationId === batchBody.operation.id));

  const finishedBatch = await waitForCondition(async () => {
    const response = await fetch(`http://127.0.0.1:${port}/api/publish/jobs`);
    return response.json();
  }, payload => payload.jobs.filter(job => ['a', 'b'].includes(job.localId)).length === 2 &&
    payload.jobs.filter(job => ['a', 'b'].includes(job.localId)).every(job => job.status === 'submitted'));
  assert.deepEqual(
    finishedBatch.jobs.filter(job => ['a', 'b'].includes(job.localId)).map(job => job.productId).sort(),
    [101, 102]
  );
  const productBJob = finishedBatch.jobs.find(job => job.localId === 'b');
  assert.equal(productBJob.finalScore, 86);
  assert.deepEqual(productBJob.deductReasons, ['主图清晰度仍可提升']);
  assert.equal('itemJsonPath' in productBJob, false);

  const duplicateResponse = await fetch(`http://127.0.0.1:${port}/api/publish/enqueue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(batchRequest),
  });
  const duplicateBody = await duplicateResponse.json();
  assert.equal(duplicateResponse.status, 200);
  assert.equal(duplicateBody.deduplicated, true);
  assert.deepEqual(duplicateBody.jobs.map(job => job.id), batchBody.jobs.map(job => job.id));

  const draftResponse = await fetch(`http://127.0.0.1:${port}/api/publish/enqueue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'draft',
      scope: 'single',
      confirmed: true,
      acknowledgement: 'I_CONFIRM_PRODUCT_WRITE',
      idempotencyKey: 'integration-single-draft-0001',
      products: [makeProduct('a', 'Product A')],
    }),
  });
  assert.equal(draftResponse.status, 202);
  const draftBody = await draftResponse.json();
  assert.equal(draftBody.operation.total, 1);
  assert.equal(draftBody.jobs[0].position, 1);
  assert.equal(draftBody.jobs[0].total, 1);
  await waitForCondition(async () => {
    const response = await fetch(`http://127.0.0.1:${port}/api/publish/jobs`);
    return response.json();
  }, payload => payload.jobs.some(job => job.action === 'draft' && job.status === 'saved_draft'));

  // publish-from-json 的补全文件路径只供服务端排障；页面得到的是可理解的业务区域。
  const failedResponse = await fetch(`http://127.0.0.1:${port}/api/publish/enqueue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'publish',
      scope: 'single',
      confirmed: true,
      acknowledgement: 'I_CONFIRM_PRODUCT_WRITE',
      idempotencyKey: 'integration-structured-failure-0001',
      products: [makeProduct('failed', 'Fail Product')],
    }),
  });
  assert.equal(failedResponse.status, 202);
  const failedJobs = await waitForCondition(async () => {
    const response = await fetch(`http://127.0.0.1:${port}/api/publish/jobs`);
    return response.json();
  }, payload => payload.jobs.some(job => job.localId === 'failed' && job.status === 'failed'));
  const failedJob = failedJobs.jobs.find(job => job.localId === 'failed');
  assert.equal(failedJob.canFixAndRetry, true);
  assert.ok(failedJob.failureFields.includes('price'));
  assert.equal('itemJsonPath' in failedJob, false);
  assert.equal(JSON.stringify(failedJob).includes('/private/tmp'), false);

  const events = (await require('node:fs/promises').readFile(eventLog, 'utf8')).trim().split('\n');
  assert.deepEqual(events, [
    'start:product:Missing platform IDs',
    'end:product:Missing platform IDs',
    'start:product:Product A',
    'end:product:Product A',
    'start:product:Product B',
    'end:product:Product B',
    'start:draft:Product A',
    'end:draft:Product A',
    'start:product:Fail Product',
    'end:product:Fail Product',
  ]);
});
