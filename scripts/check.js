/**
 * npm run check — T20 內容規則與品質檢查
 * 任一項失敗就回報錯誤並以非 0 結束（exit code 1）。
 * 執行前請先 `npm run build`（package.json 的 check script 已經會自動先 build 一次）。
 */
const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..');
const siteDir = path.join(repoRoot, '_site');
const srcDir = path.join(repoRoot, 'src');

let hasFailure = false;
const results = [];

function report(name, ok, details) {
  results.push({ name, ok, details: details || [] });
  if (!ok) hasFailure = true;
}

function walk(dir, filter) {
  let out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out = out.concat(walk(full, filter));
    } else if (!filter || filter(full)) {
      out.push(full);
    }
  }
  return out;
}

const htmlFiles = walk(siteDir, (f) => f.endsWith('.html'));

// ──────────────────────────────────────────────
// 1. 密鑰 / token / 密碼樣式掃描
// ──────────────────────────────────────────────
function checkSecrets() {
  const patterns = [
    { name: 'Google API Key', re: /AIza[0-9A-Za-z_-]{35}/ },
    { name: 'AWS Access Key', re: /AKIA[0-9A-Z]{16}/ },
    { name: 'Private Key Block', re: /-----BEGIN (RSA |EC |)PRIVATE KEY-----/ },
    { name: 'password 賦值', re: /password\s*[:=]\s*['"][^'"]+['"]/i },
    { name: 'api[-_]?key 賦值', re: /api[-_]?key\s*[:=]\s*['"][^'"]+['"]/i },
    { name: 'secret 賦值', re: /\bsecret\s*[:=]\s*['"][^'"]+['"]/i },
    { name: 'Bearer token', re: /Bearer\s+[A-Za-z0-9\-._~+/]{20,}/ },
  ];
  const scanFiles = walk(srcDir, (f) => /\.(njk|js|json|css|html)$/.test(f));
  const errors = [];
  scanFiles.forEach((f) => {
    const content = fs.readFileSync(f, 'utf8');
    patterns.forEach((p) => {
      if (p.re.test(content)) {
        errors.push(`${path.relative(repoRoot, f)}：疑似出現 ${p.name}`);
      }
    });
  });
  report('1. 密鑰/token/密碼樣式掃描', errors.length === 0, errors);
}

// ──────────────────────────────────────────────
// 2. 內部檔案是否被 git 追蹤
// ──────────────────────────────────────────────
function checkInternalFilesNotTracked() {
  const { execSync } = require('child_process');
  let tracked;
  try {
    tracked = execSync('git ls-files', { cwd: repoRoot, encoding: 'utf8' }).split('\n');
  } catch (e) {
    report('2. 內部檔案是否被 git 追蹤', false, ['無法執行 git ls-files：' + e.message]);
    return;
  }
  const forbiddenPatterns = [
    /^CLAUDE\.md$/,
    /^SPEC_網站規格\.md$/,
    /^TASKS_修改任務清單\.md$/,
    /^AEO_.*\.md$/,
    /^COPY_REVIEW\.md$/,
    /^UNDERSTANDING_交接理解摘要\.md$/,
    /^AMPINTEC-PLUS_網站規劃\.md$/,
    /^task\.md$/,
    /^LEGAL_.*\.md$/,
    /^docs\/repo-setup\.md$/,
    /^docs\/apps-script\.gs\.txt$/,
    /^docs\/ga4-admin-notes\.md$/,
  ];
  const errors = [];
  tracked.forEach((f) => {
    if (forbiddenPatterns.some((re) => re.test(f))) {
      errors.push(`內部文件被 git 追蹤：${f}`);
    }
  });
  report('2. 內部檔案是否被 git 追蹤', errors.length === 0, errors);
}

// ──────────────────────────────────────────────
// 3. 交期「7 天起」一致性
// ──────────────────────────────────────────────
function checkLeadTime() {
  const errors = [];
  htmlFiles.forEach((f) => {
    const html = fs.readFileSync(f, 'utf8');
    const m = html.match(/<span class="stat-number" id="stat-lead"[^>]*>([^<]*)<\/span>/);
    if (m) {
      const text = m[1].trim();
      const isZh = f.includes(`${path.sep}zh${path.sep}`);
      // 黃總 2026-11-17 F-32：英文版數字改成 "From 7 Days"（標籤同步改成 "Fastest Lead Time"，
      // 合起來讀作 "Fastest Lead Time: From 7 Days"），中文版維持「7 天起」不變。
      const expected = isZh ? '7 天起' : 'From 7 Days';
      if (text !== expected) {
        errors.push(`${path.relative(siteDir, f)}：stat-lead 文字是「${text}」，預期「${expected}」`);
      }
    }
  });
  report('3. 交期「7 天起」一致性', errors.length === 0, errors);
}

// ──────────────────────────────────────────────
// 4. 證書僅 AS9100D / ISO 9001（無範圍／編號／發證單位／有效期限）
// ──────────────────────────────────────────────
function checkCertifications() {
  // 這幾個詞彙本身在法律頁（Terms 的報價條款、Privacy 的各種「issued」用法等）可能合法出現，
  // 所以不整頁掃描，只在 AS9100D／ISO 9001 字樣「附近」出現時才視為違規（避免誤判）。
  const certMentionRe = /AS9100D|ISO\s*9001/gi;
  const forbiddenNear = [
    /AEROSPACE STANDARD/i,
    /QUALITY MANAGEMENT/i,
    /證書編號/,
    /發證單位/,
    /有效期限/,
    /certificate\s*(no\.?|number)/i,
    /certif\w*\s+issued\s+by/i,
    /scope\s+of\s+(certification|certificate)/i,
    /valid\s+(until|through)\s+\d/i,
    /expir(y|ation|es)\b/i,
  ];
  const WINDOW = 120;
  const errors = [];
  htmlFiles.forEach((f) => {
    const html = fs.readFileSync(f, 'utf8');
    const text = html.replace(/<[^>]+>/g, ' ');
    let m;
    while ((m = certMentionRe.exec(text)) !== null) {
      const start = Math.max(0, m.index - WINDOW);
      const end = Math.min(text.length, m.index + m[0].length + WINDOW);
      const window = text.slice(start, end);
      forbiddenNear.forEach((re) => {
        if (re.test(window)) {
          errors.push(`${path.relative(siteDir, f)}：「${m[0]}」附近出現疑似認證範圍/編號/發證單位/有效期限文字（符合 ${re}）`);
        }
      });
    }
  });
  report('4. 證書僅 AS9100D／ISO 9001', errors.length === 0, errors);
}

// ──────────────────────────────────────────────
// 10. 衝突交期數字掃描（T35：黃總 2026-11-12 交期全站定調為「交期最快 7 天起」；
//     A1 2026-11-14／2026-11-17：僅 /about/「研發週期縮短案例」可保留
//     「傳統製造 3 個月／AMPINTEC PLUS 2 週」作為研發週期比較，不是交期承諾）
// ──────────────────────────────────────────────
function checkConflictingLeadTime() {
  const errors = [];
  const llmsFile = path.join(siteDir, 'llms.txt');
  const scanFiles = [...htmlFiles, ...(fs.existsSync(llmsFile) ? [llmsFile] : [])];
  // 沒有例外：這些字樣全站（含 /about/）都不可出現。
  const alwaysBannedPatterns = [
    { name: '「14 至 30」', re: /14\s*至\s*30/ },
    { name: '「14 to 30 days」', re: /14\s*to\s*30\s*days/i },
    { name: '「一般原型樣品約 14」', re: /一般原型樣品約\s*14/ },
  ];
  // 僅 /zh/about/、/en/about/ 的「研發週期縮短案例」白名單；其他路徑出現即報錯（黃總 A1）。
  const aboutOnlyPatterns = [
    { name: '「傳統製造：3個月」', re: /傳統製造[:：]\s*3\s*個月/ },
    { name: '「AMPINTEC PLUS：2週」', re: /AMPINTEC PLUS[:：]\s*2\s*週/ },
    { name: '「Traditional: 3 Months」', re: /Traditional:\s*3\s*Months/i },
    { name: '「AMPINTEC PLUS: 2 Weeks」', re: /AMPINTEC PLUS:\s*2\s*Weeks/i },
  ];
  const ABOUT_WHITELIST_FILES = [
    path.join(siteDir, 'zh', 'about', 'index.html'),
    path.join(siteDir, 'en', 'about', 'index.html'),
  ];
  scanFiles.forEach((f) => {
    const text = fs.readFileSync(f, 'utf8');
    alwaysBannedPatterns.forEach((p) => {
      if (p.re.test(text)) {
        errors.push(`${path.relative(siteDir, f)}：出現與定調交期衝突的 ${p.name}`);
      }
    });
    const isAboutWhitelisted = ABOUT_WHITELIST_FILES.includes(f);
    aboutOnlyPatterns.forEach((p) => {
      if (p.re.test(text) && !isAboutWhitelisted) {
        errors.push(`${path.relative(siteDir, f)}：出現衝突交期 ${p.name}（僅允許在 /about/ 研發週期縮短案例段落，黃總 A1）`);
      }
    });
  });
  report('10. 衝突交期數字掃描（僅允許「交期最快 7 天起」/"Lead time from 7 days"）', errors.length === 0, errors);
}

// ──────────────────────────────────────────────
// 11. 10/28 know-how 與法務禁用字樣掃描（含供應鏈敏感詞、第三方圖片殘留字樣）
// ──────────────────────────────────────────────

// 白名單：現有網站本來就有、經黃總/AEO 規格核准保留的既有文字，不算違規，
// 也不改現有文字（AEO_優化規格.md §13：「現有鍛造文案若已出現『疲勞壽命』
// 等字，屬既有內容，不刪不改；但不可再新增測試或數據。」）。
const BANNED_WHITELIST = [
  {
    label: '疲勞壽命／fatigue life（既有鍛造工藝描述，AEO_優化規格.md §13 核准保留，不得再新增疲勞測試相關文字）',
    patterns: [/疲勞壽命/g, /fatigue life/gi],
  },
];

function stripWhitelisted(text) {
  return BANNED_WHITELIST.reduce((out, w) => w.patterns.reduce((t, re) => t.replace(re, ''), out), text);
}

function checkBannedPhrases() {
  const errors = [];
  const llmsFile = path.join(siteDir, 'llms.txt');
  const scanFiles = [...htmlFiles, ...(fs.existsSync(llmsFile) ? [llmsFile] : [])];
  const bannedPatterns = [
    { name: '一頁式網站', re: /一頁式網站/ },
    { name: 'ANC（整字、區分大小寫）', re: /\bANC\b/ },
    { name: '試片', re: /試片/i },
    { name: 'test coupon', re: /test coupon/i },
    { name: '疲勞', re: /疲勞/i },
    { name: 'fatigue', re: /fatigue/i },
    { name: '陽極', re: /陽極/i },
    { name: 'anodiz', re: /anodiz/i },
    { name: '模具周邊', re: /模具周邊/i },
    { name: 'mold peripheral', re: /mold peripheral/i },
    { name: '（非）紅色供應鏈', re: /非?紅色供應鏈/i },
    { name: 'non-red', re: /non-red/i },
    { name: '非中國', re: /非中國/i },
    { name: 'non-China', re: /non-china/i },
    { name: '圖片來源', re: /圖片來源/ },
  ];
  scanFiles.forEach((f) => {
    const text = stripWhitelisted(fs.readFileSync(f, 'utf8'));
    bannedPatterns.forEach((p) => {
      if (p.re.test(text)) {
        errors.push(`${path.relative(siteDir, f)}：出現禁用字樣「${p.name}」`);
      }
    });
  });
  report('11. 10/28 know-how／供應鏈敏感詞／圖片來源字樣掃描', errors.length === 0, errors);
}

// ──────────────────────────────────────────────
// 5. 無價格字樣（檢查實際金額樣式，不檢查「報價」一詞本身）
// ──────────────────────────────────────────────
function checkNoPricing() {
  const patterns = [
    /NT\$\s?\d/,
    /US\$\s?\d/,
    /\$\s?\d{1,3}(,\d{3})*(\.\d+)?/,
    /新台幣\s?\d/,
    /台幣\s?\d/,
    /報價[:：]\s?\d/,
    /單價[:：]\s?\d/,
  ];
  const errors = [];
  htmlFiles.forEach((f) => {
    const html = fs.readFileSync(f, 'utf8');
    patterns.forEach((re) => {
      const m = html.match(re);
      if (m) {
        errors.push(`${path.relative(siteDir, f)}：出現疑似價格字樣「${m[0]}」`);
      }
    });
  });
  report('5. 無價格字樣', errors.length === 0, errors);
}

// ──────────────────────────────────────────────
// 6. 中英文 i18n key 一致
// ──────────────────────────────────────────────
function collectKeyPaths(obj, prefix = '') {
  let keys = [];
  for (const k of Object.keys(obj)) {
    const full = prefix ? `${prefix}.${k}` : k;
    const v = obj[k];
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      keys = keys.concat(collectKeyPaths(v, full));
    } else {
      keys.push(full);
    }
  }
  return keys;
}

function checkI18nKeys() {
  const zh = JSON.parse(fs.readFileSync(path.join(srcDir, '_data/i18n/zh.json'), 'utf8'));
  const en = JSON.parse(fs.readFileSync(path.join(srcDir, '_data/i18n/en.json'), 'utf8'));
  const zhKeys = new Set(collectKeyPaths(zh));
  const enKeys = new Set(collectKeyPaths(en));
  const missingInEn = [...zhKeys].filter((k) => !enKeys.has(k));
  const missingInZh = [...enKeys].filter((k) => !zhKeys.has(k));
  const errors = [];
  missingInEn.forEach((k) => errors.push(`en.json 缺少 key：${k}`));
  missingInZh.forEach((k) => errors.push(`zh.json 缺少 key：${k}`));
  report(`6. 中英文 i18n key 一致（共 ${zhKeys.size} 個）`, errors.length === 0, errors);
}

// ──────────────────────────────────────────────
// 7. 內部連結無斷鏈
//    上線用的 GitHub Pages 測試網址需要 path prefix（例如
//    /ampintecplus-site/），建置出來的連結會長成
//    "/ampintecplus-site/zh/..."，但 _site 資料夾本身沒有那層子目錄。
//    用跟 CI 建置時同一個 PATH_PREFIX 環境變數，在比對檔案前先把這段
//    前綴去掉；本機沒設這個變數時維持原本行為（無前綴）。
// ──────────────────────────────────────────────
const RAW_PATH_PREFIX = process.env.PATH_PREFIX || '';
const PATH_PREFIX = RAW_PATH_PREFIX && RAW_PATH_PREFIX !== '/'
  ? '/' + RAW_PATH_PREFIX.replace(/^\/+|\/+$/g, '')
  : '';

function stripPathPrefix(linkPath) {
  if (!PATH_PREFIX) return linkPath;
  if (linkPath === PATH_PREFIX) return '/';
  if (linkPath.startsWith(PATH_PREFIX + '/')) return linkPath.slice(PATH_PREFIX.length);
  return linkPath;
}

function checkInternalLinks() {
  const errors = [];

  function resolveTarget(linkPath) {
    let clean = linkPath.split('#')[0].split('?')[0];
    if (!clean) return null; // 純 #anchor，不檢查
    let filePath = path.join(siteDir, clean);
    if (clean.endsWith('/')) filePath = path.join(filePath, 'index.html');
    return filePath;
  }

  htmlFiles.forEach((f) => {
    const html = fs.readFileSync(f, 'utf8');
    const matches = [...html.matchAll(/(?:href|src)="([^"]+)"/g)];
    matches.forEach((m) => {
      const rawLink = m[1];
      if (!rawLink.startsWith('/')) return; // 只檢查站內的根相對路徑連結
      if (rawLink.startsWith('//')) return; // protocol-relative，視為外部
      const link = stripPathPrefix(rawLink);
      const target = resolveTarget(link);
      if (!target) return;
      if (!fs.existsSync(target)) {
        // 嘗試不加 index.html（例如直接檔案，如 /favicon.ico）
        const asFile = path.join(siteDir, link.split('#')[0].split('?')[0]);
        if (!fs.existsSync(asFile)) {
          errors.push(`${path.relative(siteDir, f)}：連結 "${rawLink}" 找不到對應檔案`);
        }
      }
    });
  });
  report('7. 內部連結無斷鏈', errors.length === 0, errors);
}

// ──────────────────────────────────────────────
// 8. noindex 仍存在
// ──────────────────────────────────────────────
function checkNoindex() {
  const siteJson = JSON.parse(fs.readFileSync(path.join(srcDir, '_data/site.json'), 'utf8'));
  const errors = [];
  if (siteJson.indexing !== false) {
    errors.push(`site.json 的 indexing 目前是 ${siteJson.indexing}，預期 false（尚未正式上線前應保持 noindex）`);
  }
  htmlFiles.forEach((f) => {
    const html = fs.readFileSync(f, 'utf8');
    if (!/<meta\s+name="robots"\s+content="noindex,\s*nofollow">/.test(html)) {
      errors.push(`${path.relative(siteDir, f)}：找不到 noindex meta tag`);
    }
  });
  report('8. noindex 仍存在', errors.length === 0, errors);
}

// ──────────────────────────────────────────────
// 9. 圖片無 EXIF/GPS
// ──────────────────────────────────────────────
function checkImageExif() {
  const imgFiles = [
    ...walk(path.join(srcDir, 'assets/img'), (f) => /\.(webp|png|jpe?g)$/i.test(f)),
    path.join(srcDir, 'favicon.ico'),
    path.join(srcDir, 'apple-touch-icon.png'),
  ].filter((f) => fs.existsSync(f));

  const errors = [];
  imgFiles.forEach((f) => {
    const buf = fs.readFileSync(f);
    // WebP 的 EXIF chunk FourCC 是大寫 "EXIF"；EXIF payload 本身的識別字串是 "Exif"。
    // 只要檔案裡找得到其中一種，就視為帶有 EXIF（因而可能含 GPS 子 IFD）。
    const hasExifMarker = buf.includes('EXIF') || buf.includes('Exif');
    if (hasExifMarker) {
      errors.push(`${path.relative(repoRoot, f)}：偵測到 EXIF 標記，可能帶有 EXIF/GPS metadata`);
    }
  });
  report(`9. 圖片無 EXIF/GPS（共檢查 ${imgFiles.length} 個檔案）`, errors.length === 0, errors);
}

// ──────────────────────────────────────────────
// 12. 標題層級：每頁恰好一個 H1，其後標題依序不跳級（A3／T37）
// ──────────────────────────────────────────────
function checkHeadingHierarchy() {
  const errors = [];
  // 根目錄語言選擇頁（index.html）依規格本身沒有內容用 H1，不列入檢查；其他頁面（含 404.html）都要檢查。
  const pagesToCheck = htmlFiles.filter((f) => f !== path.join(siteDir, 'index.html'));
  pagesToCheck.forEach((f) => {
    const html = fs.readFileSync(f, 'utf8');
    const headings = [...html.matchAll(/<h([1-6])[ >]/g)].map((m) => parseInt(m[1], 10));
    const h1Count = headings.filter((h) => h === 1).length;
    if (h1Count !== 1) {
      errors.push(`${path.relative(siteDir, f)}：H1 數量為 ${h1Count}，應恰好 1 個`);
    }
    let prev = 0;
    headings.forEach((level) => {
      if (level > prev + 1) {
        errors.push(`${path.relative(siteDir, f)}：標題從 h${prev} 跳到 h${level}`);
      }
      prev = level;
    });
  });
  report('12. 標題層級（每頁一個 H1，不跳級）', errors.length === 0, errors);
}

// ──────────────────────────────────────────────
// 13. 全站不得出現本公司客戶案例（黃總 E2 最終決定）
// ──────────────────────────────────────────────
function checkNoCustomerCases() {
  const errors = [];
  const patterns = [
    { name: 'AMPINTEC 技術與加工實績', re: /AMPINTEC\s*技術與加工實績/ },
    { name: 'AMPINTEC Track Record / Case Studies（客戶實績標題殘留）', re: /AMPINTEC\s*(Track Record|Technical\s*(&|and)\s*Process(ing)?\s*Track Record)/i },
  ];
  htmlFiles.forEach((f) => {
    const text = fs.readFileSync(f, 'utf8');
    patterns.forEach((p) => {
      if (p.re.test(text)) {
        errors.push(`${path.relative(siteDir, f)}：出現「${p.name}」（黃總 E2 決定：網站不放本公司客戶案例）`);
      }
    });
  });
  report('13. 全站不放本公司客戶案例（E2）', errors.length === 0, errors);
}

// ──────────────────────────────────────────────
// 14. 絕對台灣用語掃描（黃總 2026-11-18：全站移除「全程台灣在地生產」這類
//     100% 肯定句，統一改成「我們在台灣設有金屬列印生產與在地供應鏈，
//     可依專案需求安排製程」。首頁 hero 副標的 "Made-in-Taiwan (MIT)"
//     是黃總定案文字，不受此項規則限制。）
// ──────────────────────────────────────────────
function checkAbsoluteTaiwanWording() {
  const errors = [];
  const llmsFile = path.join(siteDir, 'llms.txt');
  const scanFiles = [...htmlFiles, ...(fs.existsSync(llmsFile) ? [llmsFile] : [])];
  const bannedPatterns = [
    { name: '全程', re: /全程/ },
    { name: 'all made in Taiwan', re: /all made in Taiwan/i },
    { name: 'entirely', re: /entirely/i },
    { name: 'completed in Taiwan', re: /completed in Taiwan/i },
  ];
  scanFiles.forEach((f) => {
    let text = fs.readFileSync(f, 'utf8');
    // hero 副標（Made-in-Taiwan (MIT) ... one-stop metal printing solution）黃總定案文字除外
    text = text.replace(/<span class="hero-subtitle"[^]*?<\/span>/g, '');
    text = text.replace(/<p class="hero-subtitle"[^]*?<\/p>/g, '');
    bannedPatterns.forEach((p) => {
      if (p.re.test(text)) {
        errors.push(`${path.relative(siteDir, f)}：出現絕對台灣用語「${p.name}」`);
      }
    });
  });
  report('14. 絕對台灣用語掃描（全程／all made in Taiwan／entirely／completed in Taiwan）', errors.length === 0, errors);
}

// ──────────────────────────────────────────────
// 15. 鎳合金關鍵字掃描（黃總 2026-11-18 補修：鎳合金／Nickel Alloy 統一改成
//     「鎳基合金（Inconel）」／"Nickel-based alloy (Inconel)"，全站不得再
//     出現舊寫法。）
// ──────────────────────────────────────────────
function checkNickelKeyword() {
  const errors = [];
  const llmsFile = path.join(siteDir, 'llms.txt');
  const scanFiles = [...htmlFiles, ...(fs.existsSync(llmsFile) ? [llmsFile] : [])];
  const bannedPatterns = [
    { name: '鎳合金（舊寫法，應為「鎳基合金（Inconel）」）', re: /鎳合金/ },
    { name: 'Nickel Alloy（舊寫法，應為 "Nickel-based alloy (Inconel)"）', re: /Nickel Alloy/i },
  ];
  scanFiles.forEach((f) => {
    const text = fs.readFileSync(f, 'utf8');
    bannedPatterns.forEach((p) => {
      if (p.re.test(text)) {
        errors.push(`${path.relative(siteDir, f)}：出現舊寫法「${p.name}」`);
      }
    });
  });
  report('15. 鎳合金關鍵字掃描（鎳合金／Nickel Alloy 舊寫法）', errors.length === 0, errors);
}

// ──────────────────────────────────────────────
// 16. 英文 About 頁研發週期標題（黃總 11/17 定案）：必須是
//     "R&D Cycle Comparison"，不得再出現舊標題 "Cycle Reduction Case Study"。
// ──────────────────────────────────────────────
function checkCycleTitle() {
  const errors = [];
  const f = path.join(siteDir, 'en', 'about', 'index.html');
  if (!fs.existsSync(f)) {
    report('16. 英文 About 頁研發週期標題（R&D Cycle Comparison）', false, [`找不到 ${path.relative(siteDir, f)}`]);
    return;
  }
  const text = fs.readFileSync(f, 'utf8');
  if (!/R&amp;D Cycle Comparison/.test(text) && !/R&D Cycle Comparison/.test(text)) {
    errors.push(`${path.relative(siteDir, f)}：找不到 "R&D Cycle Comparison"`);
  }
  if (/Cycle Reduction Case Study/.test(text)) {
    errors.push(`${path.relative(siteDir, f)}：仍出現舊標題 "Cycle Reduction Case Study"`);
  }
  report('16. 英文 About 頁研發週期標題（R&D Cycle Comparison）', errors.length === 0, errors);
}

// ──────────────────────────────────────────────
// 17. 產業頁公開資料參考卡逐張加註（黃總 11/17 定案）：#industry-trends
//     底下每一張 .category-card 都必須含「公開資料，非本公司製造，亦非
//     本公司客戶。」／"Public information; not manufactured by us and
//     not our customer."
// ──────────────────────────────────────────────
function checkIndustryTrendsNote() {
  const errors = [];
  const targets = [
    { f: path.join(siteDir, 'zh', 'industries', 'index.html'), note: '公開資料，非本公司製造，亦非本公司客戶。' },
    { f: path.join(siteDir, 'en', 'industries', 'index.html'), note: 'Public information; not manufactured by us and not our customer.' },
  ];
  targets.forEach(({ f, note }) => {
    if (!fs.existsSync(f)) {
      errors.push(`找不到 ${path.relative(siteDir, f)}`);
      return;
    }
    const html = fs.readFileSync(f, 'utf8');
    const sectionMatch = html.match(/id="industry-trends"[^]*?<\/section>/);
    if (!sectionMatch) {
      errors.push(`${path.relative(siteDir, f)}：找不到 #industry-trends 區段`);
      return;
    }
    const section = sectionMatch[0];
    // 卡片之間沒有巢狀 div，用分隔字串切開就好：split 後每個 chunk（最後一個
    // 除外）恰好就是該卡片自己的內容，不需要再做任何裁切。
    const cardChunks = section.split('<div class="category-card">').slice(1);
    if (cardChunks.length === 0) {
      errors.push(`${path.relative(siteDir, f)}：#industry-trends 區段找不到任何 .category-card`);
      return;
    }
    cardChunks.forEach((chunk, i) => {
      if (!chunk.includes(note)) {
        errors.push(`${path.relative(siteDir, f)}：#industry-trends 第 ${i + 1} 張 .category-card 缺少公開資料加註`);
      }
    });
  });
  report('17. 產業頁公開資料參考卡逐張加註', errors.length === 0, errors);
}

// ──────────────────────────────────────────────
// 執行全部檢查並輸出報告
// ──────────────────────────────────────────────
checkSecrets();
checkInternalFilesNotTracked();
checkLeadTime();
checkCertifications();
checkNoPricing();
checkI18nKeys();
checkInternalLinks();
checkNoindex();
checkImageExif();
checkConflictingLeadTime();
checkBannedPhrases();
checkHeadingHierarchy();
checkNoCustomerCases();
checkAbsoluteTaiwanWording();
checkNickelKeyword();
checkCycleTitle();
checkIndustryTrendsNote();

console.log('='.repeat(60));
results.forEach((r) => {
  console.log(`${r.ok ? '✅' : '❌'} ${r.name}`);
  if (!r.ok) {
    r.details.forEach((d) => console.log('   - ' + d));
  }
});
console.log('='.repeat(60));
if (BANNED_WHITELIST.length) {
  console.log('白名單（現有已核准內容，不計入第 11 項禁用字樣掃描，不改現有文字）：');
  BANNED_WHITELIST.forEach((w) => console.log(' - ' + w.label));
  console.log('='.repeat(60));
}
console.log('第 10 項交期掃描白名單：/zh/about/、/en/about/ 的「研發週期縮短案例」可保留「傳統製造 3 個月／AMPINTEC PLUS 2 週」（黃總 A1，2026-11-14／2026-11-17），其他路徑仍 0 容忍。');
console.log('='.repeat(60));

if (hasFailure) {
  console.log('❌ npm run check 失敗，請修正上面列出的項目後再推送。');
  process.exit(1);
} else {
  console.log(`✅ 全部 ${results.length} 項檢查通過。`);
  process.exit(0);
}
