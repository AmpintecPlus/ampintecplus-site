document.addEventListener('DOMContentLoaded', () => {
  const isZh = document.documentElement.lang.indexOf('zh') === 0;

  // --- 0. 表單來源追蹤（UTM／Referrer 判斷）---
  // 只存「第一次進站」的來源到 sessionStorage，供聯絡表單 source 隱藏欄位使用。
  // 不使用任何第三方 script，不記錄 IP 或個資，只讀取 UTM 參數與 document.referrer。
  (function trackSource() {
    var STORAGE_KEY = 'ampintec_source';
    var stored = null;
    try {
      stored = sessionStorage.getItem(STORAGE_KEY);
    } catch (e) {}
    if (stored) return; // 已有第一次進站的來源記錄，不覆寫

    var params = new URLSearchParams(window.location.search);
    var utmSource = params.get('utm_source');
    var source;

    if (utmSource) {
      var utmMedium = params.get('utm_medium');
      source = utmMedium ? utmSource + '/' + utmMedium : utmSource;
    } else {
      var ref = document.referrer;
      if (!ref) {
        source = 'direct';
      } else {
        var hostname = '';
        try {
          hostname = new URL(ref).hostname.replace(/^www\./, '');
        } catch (e) {
          hostname = '';
        }
        if (/(^|\.)google\./.test(hostname)) {
          source = 'google-search';
        } else if (/(^|\.)bing\.com$/.test(hostname)) {
          source = 'bing-search';
        } else if (/(^|\.)threads\.net$/.test(hostname)) {
          source = 'threads';
        } else if (/(^|\.)linkedin\.com$/.test(hostname)) {
          source = 'linkedin';
        } else if (hostname && hostname !== window.location.hostname) {
          source = hostname;
        } else {
          source = 'direct';
        }
      }
    }

    try {
      sessionStorage.setItem(STORAGE_KEY, source);
    } catch (e) {}
  })();


  // --- 1. 漢堡選單 (RWD，全螢幕覆蓋) ---
  const navToggle = document.getElementById('js-nav-toggle');
  const navMenu = document.getElementById('js-nav-menu');
  const navBackdrop = document.getElementById('js-nav-backdrop');

  function closeMenu(returnFocus) {
    if (!navToggle || !navMenu) return;
    const wasOpen = navToggle.getAttribute('aria-expanded') === 'true';
    navToggle.classList.remove('open');
    navMenu.classList.remove('mobile-active');
    if (navBackdrop) navBackdrop.classList.remove('show');
    document.body.classList.remove('nav-open');
    navToggle.setAttribute('aria-expanded', 'false');
    navToggle.setAttribute('aria-label', navToggle.dataset.labelOpen || navToggle.getAttribute('aria-label'));
    if (returnFocus && wasOpen) {
      navToggle.focus();
    }
  }

  function openMenu() {
    if (!navToggle || !navMenu) return;
    navToggle.classList.add('open');
    navMenu.classList.add('mobile-active');
    if (navBackdrop) navBackdrop.classList.add('show');
    document.body.classList.add('nav-open');
    navToggle.setAttribute('aria-expanded', 'true');
    navToggle.setAttribute('aria-label', navToggle.dataset.labelClose || navToggle.getAttribute('aria-label'));
    // 開啟選單時焦點移到第一個連結
    const firstLink = navMenu.querySelector('.nav-link, a, button');
    if (firstLink) firstLink.focus();
  }

  if (navToggle && navMenu) {
    navToggle.setAttribute('aria-expanded', 'false');

    navToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = navToggle.getAttribute('aria-expanded') === 'true';
      if (isOpen) {
        closeMenu(false);
      } else {
        openMenu();
      }
    });

    // 點擊選單連結時自動收起選單
    document.querySelectorAll('.nav-link').forEach(link => {
      link.addEventListener('click', () => closeMenu(false));
    });

    // 點擊半透明遮罩收起選單
    if (navBackdrop) {
      navBackdrop.addEventListener('click', () => closeMenu(false));
    }

    // 點擊選單以外的任何地方收起選單
    document.addEventListener('click', (e) => {
      if (!navMenu.contains(e.target) && !navToggle.contains(e.target)) {
        closeMenu(false);
      }
    });

    // Esc 鍵收起選單並把焦點移回漢堡鍵（鍵盤操作）
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' || e.key === 'Esc') {
        closeMenu(true);
      }
    });
  }


  // --- 2. Header 滾動效果 + 導覽列目前所在頁高亮 ---
  const header = document.querySelector('.header');
  const navLinks = document.querySelectorAll('.nav-link');

  const isHomePage = document.body.classList.contains('is-home');

  window.addEventListener('scroll', () => {
    // 滾動背景毛玻璃效果：只有首頁依捲動切換，內頁 header 一律實心（見 body.is-inner CSS）
    if (header && isHomePage) {
      if (window.scrollY > 50) {
        header.classList.add('header-scrolled');
      } else {
        header.classList.remove('header-scrolled');
      }
    }
  });

  // 依目前網址路徑，幫對應的導覽列連結（含手機全螢幕選單裡的連結）加上 .active；
  // 首頁用完全相符，其餘頁面用「路徑開頭相符」，讓子頁（例如 /services/xxx/）也能點亮上層的服務選單。
  (function highlightCurrentNav() {
    const currentPath = window.location.pathname;
    let bestLink = null;
    let bestLength = -1;

    navLinks.forEach(link => {
      link.classList.remove('active');
      const linkPath = link.pathname;
      const isHomeLink = /^\/(zh|en)\/$/.test(linkPath);
      const matches = isHomeLink
        ? currentPath === linkPath
        : currentPath === linkPath || currentPath.startsWith(linkPath);
      if (matches && linkPath.length > bestLength) {
        bestLink = link;
        bestLength = linkPath.length;
      }
    });

    if (bestLink) bestLink.classList.add('active');
  })();


  // --- 3. 數據動畫 ---
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function animateStats() {
    // 精度與研發週期：不做數字遞增（動畫過程中會出現 ±0.8mm、25% 這類從未發生過的錯誤數值），
    // 改成淡入已經是最終值的文字本身（HTML 一開始就是正確的最終值，JS 只負責加淡入效果）。
    // 開了「減少動態」時，全站 CSS 已把 transition-duration 強制設為 0.001ms，等同直接顯示。
    ['stat-precision', 'stat-cycle'].forEach((id) => {
      const el = document.getElementById(id);
      if (el && !el.classList.contains('animated')) {
        el.classList.add('animated', 'stat-fade');
        requestAnimationFrame(() => {
          requestAnimationFrame(() => el.classList.add('stat-fade-in'));
        });
      }
    });

    // 交期動畫：從 0 遞增到目標天數。開了「減少動態」時直接顯示最終數字，不跑遞增過程。
    const leadEl = document.getElementById('stat-lead');
    if (leadEl && !leadEl.classList.contains('animated')) {
      leadEl.classList.add('animated');
      const target = parseInt(leadEl.getAttribute('data-target'), 10);

      if (prefersReducedMotion) {
        leadEl.textContent = isZh ? `${target} 天起` : `From ${target} Days`;
        return;
      }

      const start = 0;
      const duration = 1500;
      const startTime = performance.now();

      function updateLead(timestamp) {
        const progress = Math.min((timestamp - startTime) / duration, 1);
        const val = Math.floor(start + (target - start) * progress);
        leadEl.textContent = isZh ? `${val} 天起` : `From ${val} Days`;
        if (progress < 1) {
          requestAnimationFrame(updateLead);
        } else {
          leadEl.textContent = isZh ? `${target} 天起` : `From ${target} Days`;
        }
      }
      requestAnimationFrame(updateLead);
    }
  }

  // 延遲一點點觸發以呈現流暢感
  setTimeout(animateStats, 300);


  // --- 4. 進度條動畫 (Intersection Observer) ---
  // (a) 研發週期進度條
  const cycleTrigger = document.getElementById('js-cycle-trigger');
  const amBar = document.getElementById('js-cycle-am-bar');

  if (cycleTrigger && amBar) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          amBar.style.width = '15.3%';
          observer.unobserve(cycleTrigger);
        }
      });
    }, { threshold: 0.2 });

    observer.observe(cycleTrigger);
  }

  // --- 5. FAQ 手風琴展開/收合（含鍵盤操作支援） ---
  const faqQuestions = document.querySelectorAll('.faq-question');

  function toggleFaq(question) {
    const item = question.parentElement;
    const answer = item.querySelector('.faq-answer');
    const isActive = item.classList.contains('active');

    document.querySelectorAll('.faq-item').forEach(otherItem => {
      otherItem.classList.remove('active');
      const otherAnswer = otherItem.querySelector('.faq-answer');
      if (otherAnswer) otherAnswer.style.maxHeight = null;
      const otherQuestion = otherItem.querySelector('.faq-question');
      if (otherQuestion) otherQuestion.setAttribute('aria-expanded', 'false');
    });

    if (!isActive) {
      item.classList.add('active');
      if (answer) answer.style.maxHeight = answer.scrollHeight + 'px';
      question.setAttribute('aria-expanded', 'true');
    }
  }

  faqQuestions.forEach(question => {
    // 讓原本是 <div> 的題目可以用鍵盤操作（Tab 聚焦、Enter/Space 觸發）
    if (!question.hasAttribute('tabindex')) {
      question.setAttribute('tabindex', '0');
    }
    question.setAttribute('role', 'button');
    question.setAttribute('aria-expanded', 'false');

    question.addEventListener('click', () => toggleFaq(question));
    question.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        toggleFaq(question);
      }
    });
  });


  // --- 6. 痛點卡片手風琴控制 ---
  const painpointCards = document.querySelectorAll('.painpoint-card');
  painpointCards.forEach(card => {
    card.addEventListener('click', () => {
      const body = card.querySelector('.painpoint-card-body');
      const toggle = card.querySelector('.painpoint-toggle');
      const isActive = card.classList.contains('active');

      if (isActive) {
        card.classList.remove('active');
        if (body) body.style.maxHeight = null;
        if (toggle) toggle.textContent = '+';
      } else {
        card.classList.add('active');
        if (body) body.style.maxHeight = body.scrollHeight + 'px';
        if (toggle) toggle.textContent = '−';
      }
    });
  });


  // --- 7. 核心技術加工能力 Tab 分類切換 ---
  const capBtns = document.querySelectorAll('.cap-cat-btn');
  const capPanels = document.querySelectorAll('.cap-panel');

  capBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetCat = btn.getAttribute('data-cat');

      capBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      capPanels.forEach(panel => {
        panel.classList.remove('active');
        if (panel.getAttribute('id') === `panel-${targetCat}`) {
          panel.classList.add('active');
        }
      });
    });
  });
});
