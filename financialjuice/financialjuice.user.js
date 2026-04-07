// ==UserScript==
// @name         FinancialJuice Cleaner + Auto Translate
// @namespace    https://www.financialjuice.com/
// @version      0.2.0
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
  const NEWS_ITEM_SELECTOR = '#mainFeed .headline-item';
  const NEWS_CONTENT_SELECTOR = '.headline-title, .headline-content';
  const SNAPSHOT_REFRESH_DELAYS = [500, 1500, 3000];
  const newsStateMap = new WeakMap();
  let isTranslationReady = false;

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

      #mainFeed .headline-item .feedWrap {
        position: relative;
        padding-right: 92px;
      }

      .fj-translation-toggle {
        position: absolute;
        top: 10px;
        right: 12px;
        z-index: 3;
        display: inline-flex;
        align-items: center;
        gap: 2px;
        padding: 2px;
        border: 1px solid rgba(255, 255, 255, 0.14);
        border-radius: 999px;
        background: rgba(19, 27, 35, 0.92);
      }

      .fj-translation-toggle button {
        border: 0;
        border-radius: 999px;
        padding: 4px 8px;
        font-size: 11px;
        line-height: 1;
        color: #9fb0c3;
        background: transparent;
        cursor: pointer;
      }

      .fj-translation-toggle button:hover {
        color: #ffffff;
      }

      .fj-translation-toggle button.is-active {
        color: #ffffff;
        background: #2b8cff;
      }

      .fj-translation-toggle button:disabled {
        opacity: 0.45;
        cursor: not-allowed;
      }

      @media (max-width: 767px) {
        #mainFeed .headline-item .feedWrap {
          padding-right: 12px;
          padding-top: 34px;
        }

        .fj-translation-toggle {
          top: 8px;
          right: 10px;
        }
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

  function getNewsState(item) {
    let state = newsStateMap.get(item);
    if (state) return state;

    state = {
      originalHTML: [],
      translatedHTML: [],
      view: 'translated',
      isApplying: false,
      snapshotTimer: null,
      toggle: null
    };

    newsStateMap.set(item, state);
    return state;
  }

  function getNewsContentNodes(item) {
    if (!(item instanceof Element)) return [];
    return Array.from(item.querySelectorAll(NEWS_CONTENT_SELECTOR));
  }

  function getNewsSnapshot(item) {
    return getNewsContentNodes(item).map((node) => node.innerHTML);
  }

  function hasSnapshotChanged(left, right) {
    if (left.length !== right.length) return true;
    return left.some((part, index) => part !== right[index]);
  }

  function captureOriginalSnapshot(item, state) {
    const snapshot = getNewsSnapshot(item);
    if (!snapshot.length) return;
    if (!state.originalHTML.length || (!isTranslationReady && hasSnapshotChanged(snapshot, state.originalHTML))) {
      state.originalHTML = snapshot;
    }
  }

  function updateToggleState(state) {
    if (!(state.toggle instanceof HTMLElement)) return;

    const translatedButton = state.toggle.querySelector('[data-view="translated"]');
    const originalButton = state.toggle.querySelector('[data-view="original"]');

    if (translatedButton instanceof HTMLButtonElement) {
      translatedButton.classList.toggle('is-active', state.view === 'translated');
      translatedButton.disabled = !state.translatedHTML.length;
    }

    if (originalButton instanceof HTMLButtonElement) {
      originalButton.classList.toggle('is-active', state.view === 'original');
      originalButton.disabled = !state.originalHTML.length;
    }
  }

  function applySnapshot(item, state, htmlParts, view) {
    const nodes = getNewsContentNodes(item);
    if (!nodes.length || nodes.length !== htmlParts.length) return;

    state.isApplying = true;

    if (view === 'original') {
      item.classList.add('notranslate');
      item.setAttribute('translate', 'no');
    } else {
      item.classList.remove('notranslate');
      item.removeAttribute('translate');
    }

    nodes.forEach((node, index) => {
      if (node.innerHTML !== htmlParts[index]) {
        node.innerHTML = htmlParts[index];
      }
    });

    state.view = view;
    updateToggleState(state);

    window.setTimeout(() => {
      state.isApplying = false;
    }, 0);
  }

  function captureTranslatedSnapshot(item, state) {
    if (state.isApplying) return;

    const snapshot = getNewsSnapshot(item);
    if (!snapshot.length) return;
    if (!state.originalHTML.length) return;
    if (!hasSnapshotChanged(snapshot, state.originalHTML)) return;

    state.translatedHTML = snapshot;
    updateToggleState(state);
  }

  function scheduleTranslatedSnapshot(item, delay = 600) {
    if (!(item instanceof Element)) return;

    const state = getNewsState(item);
    if (state.snapshotTimer) {
      window.clearTimeout(state.snapshotTimer);
    }

    state.snapshotTimer = window.setTimeout(() => {
      state.snapshotTimer = null;
      captureTranslatedSnapshot(item, state);
    }, delay);
  }

  function scheduleTranslatedSnapshotRefresh(item) {
    SNAPSHOT_REFRESH_DELAYS.forEach((delay) => {
      window.setTimeout(() => {
        scheduleTranslatedSnapshot(item, 0);
      }, delay);
    });
  }

  function refreshAllTranslatedSnapshots() {
    document.querySelectorAll(NEWS_ITEM_SELECTOR).forEach((item) => {
      scheduleTranslatedSnapshotRefresh(item);
    });
  }

  function handleToggleClick(event) {
    const button = event.target.closest('.fj-translation-toggle button');
    if (!(button instanceof HTMLButtonElement)) return;

    const item = button.closest('.headline-item');
    if (!(item instanceof Element)) return;

    const state = getNewsState(item);
    const nextView = button.dataset.view;

    if (nextView === 'original' && state.originalHTML.length) {
      applySnapshot(item, state, state.originalHTML, 'original');
      return;
    }

    if (nextView === 'translated' && state.translatedHTML.length) {
      applySnapshot(item, state, state.translatedHTML, 'translated');
      return;
    }

    if (nextView === 'translated') {
      state.view = 'translated';
      item.classList.remove('notranslate');
      item.removeAttribute('translate');
      updateToggleState(state);
      triggerTranslate();
      scheduleTranslatedSnapshotRefresh(item);
    }
  }

  function mountTranslationToggle(item, state) {
    if (state.toggle?.isConnected) return;

    const feedWrap = item.querySelector('.feedWrap');
    if (!(feedWrap instanceof Element)) return;

    const toggle = document.createElement('div');
    toggle.className = 'fj-translation-toggle notranslate';
    toggle.setAttribute('translate', 'no');
    toggle.innerHTML = `
      <button type="button" data-view="translated">翻译</button>
      <button type="button" data-view="original">原文</button>
    `;

    feedWrap.appendChild(toggle);
    state.toggle = toggle;
    updateToggleState(state);
  }

  function prepareNewsItem(item) {
    if (!(item instanceof Element)) return;

    const state = getNewsState(item);
    captureOriginalSnapshot(item, state);
    mountTranslationToggle(item, state);

    if (isTranslationReady && state.view !== 'original') {
      scheduleTranslatedSnapshotRefresh(item);
    }
  }

  function processNewsMutationTarget(target) {
    if (!(target instanceof Element)) return;

    const item = target.matches('.headline-item') ? target : target.closest('.headline-item');
    if (!(item instanceof Element)) return;

    prepareNewsItem(item);

    const state = getNewsState(item);
    if (isTranslationReady && state.view !== 'original' && !state.isApplying) {
      scheduleTranslatedSnapshot(item);
    }
  }

  function observeNewsItems() {
    document.querySelectorAll(NEWS_ITEM_SELECTOR).forEach(prepareNewsItem);
    document.addEventListener('click', handleToggleClick);
    const feedRoot = document.getElementById('mainFeed') || document.body;

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        processNewsMutationTarget(mutation.target);

        for (const node of mutation.addedNodes) {
          if (!(node instanceof Element)) continue;
          processNewsMutationTarget(node);
          node.querySelectorAll?.('.headline-item').forEach(prepareNewsItem);
        }
      }
    });

    observer.observe(feedRoot, {
      childList: true,
      subtree: true,
      characterData: true
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
        isTranslationReady = true;
        refreshAllTranslatedSnapshots();
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
    observeNewsItems();
    initTranslate();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
