// ==UserScript==
// @name         FinancialJuice Cleaner + Auto Translate
// @namespace    https://www.financialjuice.com/
// @version      0.1.0
// @description  Remove ads/promotional blocks on FinancialJuice home and auto-trigger Google Translate to Chinese.
// @author       Codex
// @match        https://www.financialjuice.com/home*
// @match        https://financialjuice.com/home*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const TARGET_LANGUAGE = 'zh-CN';
  const RELOAD_FLAG = '__fj_translate_reload__';
  const TRANSLATE_COOKIE = `/auto/${TARGET_LANGUAGE}`;

  const adSelectors = [
    '.adplugg-tag',
    '[id*="adplugg"]',
    '[class*="adplugg"]',
    '.tradingview-widget-container',
    '.tradingview-widget-copyright',
    '.ts-widget',
    '#divWorthYourTime',
    '.goelite-button',
    'a[href*="tickstrike.com"]',
    'a[href*="tradingview.com"]',
    'a[href*="financialjuice.com/purchase"]',
    'a[href*="/purchase"]',
    'a[href*="pro.financialjuice.com/partners"]',
    'a[href*="/partners"]'
  ];

  const removalHints = [
    'adplugg',
    'tradingview',
    'tickstrike',
    'partner',
    'affiliate',
    'sponsor',
    'promo',
    'advert'
  ];

  function injectBaseStyles() {
    const style = document.createElement('style');
    style.textContent = `
      .adplugg-tag,
      [id*="adplugg"],
      [class*="adplugg"],
      .tradingview-widget-container,
      .tradingview-widget-copyright,
      .ts-widget,
      #divWorthYourTime,
      .goelite-button,
      .skiptranslate,
      iframe.goog-te-banner-frame {
        display: none !important;
        visibility: hidden !important;
      }

      body {
        top: 0 !important;
      }

      #google_translate_element {
        position: fixed !important;
        left: -9999px !important;
        top: -9999px !important;
        opacity: 0 !important;
        pointer-events: none !important;
      }
    `;
    document.documentElement.appendChild(style);
  }

  function textOf(el) {
    return `${el.id || ''} ${el.className || ''} ${el.textContent || ''}`.toLowerCase();
  }

  function isPromoLink(el) {
    if (!(el instanceof HTMLAnchorElement)) return false;
    const href = (el.href || '').toLowerCase();
    return (
      href.includes('financialjuice.com/purchase') ||
      href.includes('/purchase') ||
      href.includes('tickstrike.com') ||
      href.includes('tradingview.com') ||
      href.includes('/partners') ||
      href.includes('affiliate')
    );
  }

  function matchesAdHeuristic(el) {
    if (!(el instanceof Element)) return false;
    if (adSelectors.some((selector) => el.matches(selector))) return true;
    if (isPromoLink(el)) return true;

    const text = textOf(el);
    return removalHints.some((hint) => text.includes(hint));
  }

  function removeNode(el) {
    if (!(el instanceof Element) || !el.isConnected) return;

    const container =
      el.closest('.tradingview-widget-container') ||
      el.closest('.ts-widget') ||
      el.closest('#divWorthYourTime') ||
      el.closest('.aside') ||
      el.closest('li') ||
      el.closest('div') ||
      el;

    if (container instanceof Element && container.isConnected) {
      container.remove();
    }
  }

  function sweepAds(root = document) {
    adSelectors.forEach((selector) => {
      root.querySelectorAll(selector).forEach(removeNode);
    });

    root.querySelectorAll('a').forEach((anchor) => {
      if (isPromoLink(anchor)) {
        removeNode(anchor);
      }
    });

    root.querySelectorAll('div, section, aside, li').forEach((node) => {
      if (matchesAdHeuristic(node)) {
        removeNode(node);
      }
    });
  }

  function observeAds() {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (!(node instanceof Element)) continue;
          if (matchesAdHeuristic(node)) {
            removeNode(node);
            continue;
          }
          sweepAds(node);
        }
      }
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  function setTranslateCookie() {
    const hostname = location.hostname.replace(/^www\./, '');
    const domains = [location.hostname, `.${hostname}`];

    for (const domain of domains) {
      document.cookie = `googtrans=${TRANSLATE_COOKIE}; path=/; domain=${domain}; SameSite=Lax`;
    }

    document.cookie = `googtrans=${TRANSLATE_COOKIE}; path=/; SameSite=Lax`;
    localStorage.setItem('googtrans', TRANSLATE_COOKIE);
  }

  function injectTranslateContainer() {
    if (document.getElementById('google_translate_element')) return;
    const container = document.createElement('div');
    container.id = 'google_translate_element';
    document.documentElement.appendChild(container);
  }

  function loadTranslateScript() {
    if (document.querySelector('script[data-fj-google-translate]')) return;

    window.googleTranslateElementInit = function () {
      if (!window.google?.translate?.TranslateElement) return;

      new window.google.translate.TranslateElement(
        {
          pageLanguage: 'en',
          autoDisplay: false,
          includedLanguages: TARGET_LANGUAGE
        },
        'google_translate_element'
      );
    };

    const script = document.createElement('script');
    script.dataset.fjGoogleTranslate = '1';
    script.src = 'https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit';
    document.documentElement.appendChild(script);
  }

  function triggerTranslate() {
    let attempts = 0;
    const maxAttempts = 40;
    const timer = window.setInterval(() => {
      attempts += 1;

      const combo = document.querySelector('.goog-te-combo');
      if (combo instanceof HTMLSelectElement) {
        if (combo.value !== TARGET_LANGUAGE) {
          combo.value = TARGET_LANGUAGE;
          combo.dispatchEvent(new Event('change', { bubbles: true }));
        }
        window.clearInterval(timer);
        sessionStorage.removeItem(RELOAD_FLAG);
        return;
      }

      if (attempts >= maxAttempts) {
        window.clearInterval(timer);
        if (!sessionStorage.getItem(RELOAD_FLAG)) {
          sessionStorage.setItem(RELOAD_FLAG, '1');
          location.reload();
        }
      }
    }, 500);
  }

  function initTranslate() {
    setTranslateCookie();
    injectTranslateContainer();
    loadTranslateScript();
    triggerTranslate();
  }

  function init() {
    injectBaseStyles();
    sweepAds();
    observeAds();
    initTranslate();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
