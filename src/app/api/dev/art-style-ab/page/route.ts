import { NextResponse } from 'next/server'

import { ART_STYLES } from '@/lib/constants'

export const runtime = 'nodejs'

function isEnabled(): boolean {
  return process.env.NODE_ENV !== 'production' || process.env.ENABLE_ART_STYLE_AB_TEST === '1'
}

function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}

export function GET() {
  if (!isEnabled()) {
    return new NextResponse('ART_STYLE_AB_TEST_DISABLED', { status: 404 })
  }

  const styles = ART_STYLES.map((style) => ({
    value: style.value,
    label: style.label,
    preview: style.preview,
    promptZh: style.promptZh,
    previewImage: style.previewImage || null,
    referenceImage: style.referenceImage || null,
  }))

  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>画面风格 A/B 测试</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: #f6f7fb;
      --panel: #ffffff;
      --muted: #6b7280;
      --text: #111827;
      --border: #d9deea;
      --primary: #6366f1;
      --danger: #b91c1c;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #0f1117;
        --panel: #171a23;
        --muted: #9ca3af;
        --text: #f9fafb;
        --border: #2b3040;
        --primary: #818cf8;
        --danger: #fca5a5;
      }
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .wrap { max-width: 1500px; margin: 0 auto; padding: 24px; }
    .hero, .panel, .runbar, .card {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 18px;
      box-shadow: 0 8px 24px rgba(15, 23, 42, .06);
    }
    .hero { padding: 22px; margin-bottom: 18px; }
    h1 { margin: 0; font-size: 26px; }
    h2 { margin: 0 0 12px; font-size: 15px; }
    p { margin: 8px 0 0; color: var(--muted); font-size: 14px; line-height: 1.6; }
    .layout { display: grid; grid-template-columns: 410px minmax(0, 1fr); gap: 18px; }
    .left { display: flex; flex-direction: column; gap: 16px; }
    .panel { padding: 16px; }
    label { display: block; font-size: 12px; font-weight: 650; color: var(--muted); margin-bottom: 10px; }
    input, select, textarea {
      width: 100%;
      margin-top: 6px;
      padding: 10px 11px;
      border: 1px solid var(--border);
      border-radius: 10px;
      background: transparent;
      color: var(--text);
      font: inherit;
      font-size: 13px;
      outline: none;
    }
    textarea { min-height: 142px; resize: vertical; line-height: 1.5; }
    input:focus, select:focus, textarea:focus { border-color: var(--primary); }
    .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .chips { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; }
    button {
      border: 1px solid var(--border);
      background: transparent;
      color: var(--text);
      border-radius: 10px;
      padding: 9px 12px;
      cursor: pointer;
      font-weight: 650;
    }
    button:hover { border-color: var(--primary); }
    button.primary {
      background: var(--primary);
      border-color: var(--primary);
      color: white;
      padding-inline: 18px;
    }
    button:disabled { opacity: .55; cursor: not-allowed; }
    .style-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
    .style {
      overflow: hidden;
      padding: 0;
      text-align: left;
      background: transparent;
    }
    .style.selected { outline: 2px solid var(--primary); border-color: var(--primary); }
    .style img { width: 100%; height: 110px; object-fit: cover; display: block; background: #111827; }
    .style-body { padding: 10px; }
    .style-title { display: flex; justify-content: space-between; gap: 8px; align-items: center; font-weight: 800; font-size: 14px; }
    .style-prompt { margin-top: 5px; color: var(--muted); font-size: 11px; line-height: 1.45; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .runbar { position: sticky; top: 0; z-index: 10; padding: 14px 16px; margin-bottom: 16px; display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .muted { color: var(--muted); font-size: 12px; }
    .results { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
    .card { overflow: hidden; }
    .card-head { padding: 12px; border-bottom: 1px solid var(--border); }
    .card h3 { margin: 0; font-size: 15px; }
    .card img { display: block; width: 100%; aspect-ratio: 1/1; object-fit: contain; background: #0b1020; }
    .error { padding: 14px; color: var(--danger); font-size: 13px; line-height: 1.5; }
    details { border-top: 1px solid var(--border); padding: 10px 12px; }
    summary { cursor: pointer; color: var(--muted); font-size: 12px; font-weight: 700; }
    pre { white-space: pre-wrap; max-height: 220px; overflow: auto; font-size: 11px; line-height: 1.5; color: var(--muted); }
    .checks { display: grid; gap: 8px; }
    .checks label { display: flex; align-items: center; gap: 8px; margin: 0; color: var(--text); font-size: 13px; }
    .checks input { width: auto; margin: 0; }
    @media (max-width: 1100px) {
      .layout { grid-template-columns: 1fr; }
      .style-grid, .results { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    @media (max-width: 700px) {
      .wrap { padding: 14px; }
      .style-grid, .results, .grid2 { grid-template-columns: 1fr; }
      .runbar { position: static; flex-direction: column; align-items: stretch; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <section class="hero">
      <h1>画面风格 A/B 测试</h1>
      <p>轻量 HTML 页面：不加载应用 layout，不请求 NextAuth session，不依赖数据库、Redis、MinIO 或 Docker。只调用 <code>/api/dev/art-style-ab/generate</code>。</p>
    </section>

    <div class="layout">
      <aside class="left">
        <section class="panel">
          <h2>模型配置</h2>
          <label>Provider
            <select id="provider">
              <option value="ark" selected>火山引擎 Ark</option>
              <option value="openai-compatible">OpenAI-compatible</option>
            </select>
          </label>
          <label>Base URL <input id="baseUrl" value="https://ark.cn-beijing.volces.com/api/v3" /></label>
          <label>API Key <input id="apiKey" type="password" autocomplete="off" placeholder="sk-..." /></label>
          <label>Model <input id="model" value="doubao-seedream-4-5-251128" /></label>
          <div class="grid2">
            <label>Size <input id="size" value="2560x1440" /></label>
            <label>Prompt 语言
              <select id="promptLocale">
                <option value="zh">中文</option>
                <option value="en">English</option>
              </select>
            </label>
            <label>Response Format
              <select id="responseFormat">
                <option value="url" selected>url</option>
                <option value="b64_json">b64_json</option>
                <option value="omit">不传</option>
              </select>
            </label>
            <label>Output Format <input id="outputFormat" placeholder="png / jpeg / webp，可留空" /></label>
            <label style="grid-column: 1 / -1;">Quality <input id="quality" placeholder="low / medium / high / auto，可留空" /></label>
          </div>
        </section>

        <section class="panel">
          <h2>测试 Prompt</h2>
          <div class="chips">
            <button data-preset="portrait">人物设定</button>
            <button data-preset="undersea">海底奇观</button>
            <button data-preset="interior">室内对话</button>
          </div>
          <textarea id="contentPrompt">鹦鹉螺号潜艇穿越发光珊瑚海底峡谷，远处有巨大的鲸影和神秘遗迹，广角镜头，画面中不得出现文字。</textarea>
        </section>

        <section class="panel">
          <h2>测试变体</h2>
          <div class="checks" id="variants"></div>
        </section>
      </aside>

      <main>
        <section class="panel" style="margin-bottom: 16px;">
          <div style="display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:12px;">
            <div>
              <h2>选择风格</h2>
              <div class="muted" id="taskSummary"></div>
            </div>
            <div>
              <button id="selectAll">全选</button>
              <button id="selectNone">清空</button>
            </div>
          </div>
          <div class="style-grid" id="styleGrid"></div>
        </section>

        <section class="runbar">
          <div>
            <strong>运行</strong>
            <div class="muted" id="status">结果仅保留在当前页面，可导出 manifest。</div>
          </div>
          <div>
            <button id="exportManifest" disabled>导出 manifest</button>
            <button class="primary" id="run">开始测试</button>
          </div>
        </section>

        <section class="results" id="results"></section>
      </main>
    </div>
  </div>

  <script>
    const STYLES = ${safeJson(styles)};
    const VARIANTS = [
      { key: 'old-text-only', label: '旧提示词 / 纯文本', promptVersion: 'old', referenceMode: 'text-only' },
      { key: 'new-text-only', label: '新提示词 / 纯文本', promptVersion: 'new', referenceMode: 'text-only' },
      { key: 'new-with-reference', label: '新提示词 / 风格参考图', promptVersion: 'new', referenceMode: 'with-reference' }
    ];
    const PROVIDER_DEFAULTS = {
      ark: {
        baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
        model: 'doubao-seedream-4-5-251128',
        size: '2560x1440',
        responseFormat: 'url'
      },
      'openai-compatible': {
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-image-1',
        size: '1024x1024',
        responseFormat: 'b64_json'
      }
    };
    const PRESETS = {
      portrait: '一个18岁少年探险家，站在神秘海底城市入口，手持旧地图，脸上带着惊讶和好奇，电影级构图，画面中不得出现文字。',
      undersea: '鹦鹉螺号潜艇穿越发光珊瑚海底峡谷，远处有巨大的鲸影和神秘遗迹，广角镜头，画面中不得出现文字。',
      interior: '一位沉稳的船长站在复古潜艇控制室内，身后是复杂仪表和圆形舷窗，侧光照亮面部，画面中不得出现文字。'
    };
    const defaultStyles = new Set(['american-comic', 'chinese-comic', 'realistic', '3d-animation', 'cinematic-cg']);
    const selectedStyles = new Set(defaultStyles);
    const selectedVariants = new Set(VARIANTS.map((item) => item.key));
    const results = [];
    let running = false;

    const $ = (id) => document.getElementById(id);
    const read = (id) => $(id).value.trim();

    function selectedStyleList() {
      return STYLES.filter((style) => selectedStyles.has(style.value));
    }
    function selectedVariantList() {
      return VARIANTS.filter((variant) => selectedVariants.has(variant.key));
    }
    function updateSummary() {
      $('taskSummary').textContent = '已选 ' + selectedStyles.size + ' 个风格，预计生成 ' + (selectedStyles.size * selectedVariants.size) + ' 张图。';
      $('run').textContent = running ? '生成中...' : '开始测试 ' + (selectedStyles.size * selectedVariants.size || '');
    }
    function renderVariants() {
      $('variants').innerHTML = VARIANTS.map((variant) => '<label><input type="checkbox" data-variant="' + variant.key + '" ' + (selectedVariants.has(variant.key) ? 'checked' : '') + ' /> ' + variant.label + '</label>').join('');
      document.querySelectorAll('[data-variant]').forEach((input) => {
        input.addEventListener('change', () => {
          if (input.checked) selectedVariants.add(input.dataset.variant);
          else selectedVariants.delete(input.dataset.variant);
          updateSummary();
        });
      });
    }
    function renderStyles() {
      $('styleGrid').innerHTML = STYLES.map((style) => {
        const selected = selectedStyles.has(style.value) ? ' selected' : '';
        const image = style.previewImage ? '<img src="' + style.previewImage + '" alt="' + style.label + '" />' : '';
        return '<button class="style' + selected + '" data-style="' + style.value + '">' + image + '<div class="style-body"><div class="style-title"><span>' + style.label + '</span><span>' + style.preview + '</span></div><div class="style-prompt">' + style.promptZh + '</div></div></button>';
      }).join('');
      document.querySelectorAll('[data-style]').forEach((button) => {
        button.addEventListener('click', () => {
          const value = button.dataset.style;
          if (selectedStyles.has(value)) selectedStyles.delete(value);
          else selectedStyles.add(value);
          renderStyles();
          updateSummary();
        });
      });
    }
    function renderResults() {
      $('results').innerHTML = results.map((item) => {
        const body = item.error
          ? '<div class="error">' + escapeHtml(item.error) + '</div>'
          : item.imageUrl
            ? '<img src="' + item.imageUrl + '" alt="' + escapeHtml(item.styleLabel + ' ' + item.variantLabel) + '" />'
            : '<div class="error">等待结果</div>';
        const prompt = item.prompt ? '<details><summary>查看实际 Prompt</summary><pre>' + escapeHtml(item.prompt) + '</pre></details>' : '';
        return '<article class="card"><div class="card-head"><h3>' + escapeHtml(item.styleLabel) + '</h3><div class="muted">' + escapeHtml(item.variantLabel) + '</div></div>' + body + prompt + '</article>';
      }).join('');
      $('exportManifest').disabled = results.length === 0;
    }
    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    }
    function downloadJson(filename, data) {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
    }
    async function runTests() {
      if (running) return;
      if ((read('provider') === 'openai-compatible' && !read('baseUrl')) || !read('apiKey') || !read('model') || !read('contentPrompt')) {
        alert('请填写 provider、apiKey、model 和测试 Prompt；OpenAI-compatible 还需要 baseUrl。');
        return;
      }
      if (selectedStyles.size === 0 || selectedVariants.size === 0) {
        alert('请至少选择一个风格和一个测试变体。');
        return;
      }
      running = true;
      results.length = 0;
      renderResults();
      updateSummary();
      for (const style of selectedStyleList()) {
        for (const variant of selectedVariantList()) {
          $('status').textContent = '正在生成：' + style.label + ' · ' + variant.label;
          const item = {
            id: style.value + ':' + variant.key + ':' + Date.now(),
            styleValue: style.value,
            styleLabel: style.label,
            variantKey: variant.key,
            variantLabel: variant.label,
            startedAt: new Date().toISOString()
          };
          try {
            const response = await fetch('/api/dev/art-style-ab/generate', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                provider: read('provider'),
                baseUrl: read('baseUrl'),
                apiKey: read('apiKey'),
                model: read('model'),
                contentPrompt: read('contentPrompt'),
                styleValue: style.value,
                promptVersion: variant.promptVersion,
                referenceMode: variant.referenceMode,
                promptLocale: read('promptLocale'),
                size: read('size'),
                responseFormat: read('responseFormat'),
                outputFormat: read('outputFormat'),
                quality: read('quality')
              })
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(payload.error || 'HTTP ' + response.status);
            item.imageUrl = payload.imageUrl;
            item.prompt = payload.prompt;
          } catch (error) {
            item.error = error && error.message ? error.message : String(error);
          }
          item.finishedAt = new Date().toISOString();
          results.push(item);
          renderResults();
        }
      }
      running = false;
      $('status').textContent = '完成。结果仅保留在当前页面，可导出 manifest。';
      updateSummary();
    }

    document.querySelectorAll('[data-preset]').forEach((button) => {
      button.addEventListener('click', () => { $('contentPrompt').value = PRESETS[button.dataset.preset]; });
    });
    $('provider').addEventListener('change', () => {
      const defaults = PROVIDER_DEFAULTS[read('provider')];
      if (!defaults) return;
      $('baseUrl').value = defaults.baseUrl;
      $('model').value = defaults.model;
      $('size').value = defaults.size;
      $('responseFormat').value = defaults.responseFormat;
    });
    $('selectAll').addEventListener('click', () => { STYLES.forEach((style) => selectedStyles.add(style.value)); renderStyles(); updateSummary(); });
    $('selectNone').addEventListener('click', () => { selectedStyles.clear(); renderStyles(); updateSummary(); });
    $('run').addEventListener('click', runTests);
    $('exportManifest').addEventListener('click', () => {
      downloadJson('art-style-ab-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json', {
        generatedAt: new Date().toISOString(),
        config: {
          provider: read('provider'),
          baseUrl: read('baseUrl'),
          model: read('model'),
          size: read('size'),
          responseFormat: read('responseFormat'),
          outputFormat: read('outputFormat') || null,
          quality: read('quality') || null,
          promptLocale: read('promptLocale'),
          contentPrompt: read('contentPrompt'),
          selectedStyles: selectedStyleList(),
          selectedVariants: selectedVariantList()
        },
        results
      });
    });
    renderVariants();
    renderStyles();
    renderResults();
    updateSummary();
  </script>
</body>
</html>`

  return new NextResponse(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}
