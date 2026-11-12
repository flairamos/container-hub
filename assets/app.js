(() => {
  'use strict';

  const DEFAULT_CATEGORIES = [
    { id: 'coding-agent', name: 'AI 编码智能体', emoji: '⌨️' },
    { id: 'llm-provider', name: '大模型供应商', emoji: '🧠' },
    { id: 'token-gateway', name: 'Token 订阅 / API 网关', emoji: '🔌' },
    { id: 'agent-framework', name: 'Agent / MCP 框架', emoji: '🧩' },
    { id: 'ai-media', name: '图像 / 视频 / 设计', emoji: '🎨' },
    { id: 'ai-writing', name: '写作 / PPT / 文档', emoji: '✍️' },
    { id: 'ai-productivity', name: '办公 / 效率', emoji: '🗂️' },
    { id: 'ai-directory', name: 'AI 工具导航', emoji: '🧭' },
    { id: 'free-api', name: '免费 / 试用 API', emoji: '🎁' },
    { id: 'learning', name: '教程与清单', emoji: '📚' },
    { id: 'ai-tool', name: '综合 AI 工具', emoji: '✨' },
  ];

  const FLAME_SVG = `
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
      <path d="M13.5 2.2c.2 2.4-.6 4.1-2 5.7-1.6 1.8-3.8 3.2-3.8 6.2 0 1.4.5 2.6 1.3 3.5-.1-.6-.1-1.2.1-1.9.4-1.5 1.5-2.7 2.7-3.7.2 1 .7 1.9 1.5 2.6 1.1 1 1.7 2.2 1.5 3.6 1.2-.8 2-2.1 2.2-3.6.4-2.6-.7-5-2.4-6.9-1.2-1.4-1.7-3.2-1.1-5.5Z"></path>
      <path d="M12 22a8 8 0 0 1-8-8c0-3.8 2.4-6.7 4.8-9.1-.4 2 .1 3.6 1.2 4.9C8.5 11.3 7 13.2 7 15.3 7 18.4 9.3 21 12 22Z" opacity=".55"></path>
    </svg>`;

  const SEARCH_SVG = `
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7"></circle>
      <path d="m20 20-3.2-3.2"></path>
    </svg>`;

  const ICON_COLORS = [
    ['#7b5cff', '#4d8dff'],
    ['#ff7a59', '#ff4d8d'],
    ['#12b886', '#0ca678'],
    ['#f59f00', '#f76707'],
    ['#845ef7', '#5c7cfa'],
    ['#20c997', '#22b8cf'],
    ['#fa5252', '#e64980'],
    ['#4263eb', '#7048e8'],
  ];

  const els = {
    content: document.getElementById('content'),
    tabs: document.getElementById('category-tabs'),
    search: document.getElementById('search'),
    updateHint: document.getElementById('update-hint'),
    repoLink: document.getElementById('repo-link'),
    footerRepo: document.getElementById('footer-repo'),
    year: document.getElementById('year'),
  };

  const state = {
    data: null,
    categories: [],
    sites: [],
    q: '',
    cat: 'all',
    searchTimer: 0,
  };

  function formatNumber(value) {
    return new Intl.NumberFormat('zh-CN').format(Number(value) || 0);
  }

  function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  }

  function isRecent(value, days) {
    const timestamp = new Date(value).getTime();
    if (Number.isNaN(timestamp)) return false;
    return Date.now() - timestamp <= days * 24 * 60 * 60 * 1000;
  }

  function safeUrl(value) {
    try {
      const url = new URL(String(value), window.location.href);
      return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '#';
    } catch {
      return '#';
    }
  }

  function safeIconUrl(value) {
    if (!value) return '';
    if (/^assets\//.test(value)) return value;
    return safeUrl(value);
  }

  function firstCharacter(text) {
    const chars = Array.from(String(text || '?').trim());
    return chars[0] || '?';
  }

  function colorFor(seed) {
    let hash = 0;
    const text = String(seed || '');
    for (let i = 0; i < text.length; i += 1) {
      hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
    }
    return ICON_COLORS[hash % ICON_COLORS.length];
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function normalizeData(raw) {
    const data = raw && typeof raw === 'object' ? raw : {};
    const sites = (Array.isArray(data.sites) ? data.sites : [])
      .filter((site) => site && site.url && site.title)
      .map((site) => ({
        ...site,
        id: String(site.id || site.url),
        category: String(site.category || 'ai-tool'),
        tags: Array.isArray(site.tags) ? site.tags : [],
        status: site.status === 'offline' ? 'offline' : 'online',
      }));

    const categoryMap = new Map();
    for (const category of Array.isArray(data.categories) ? data.categories : []) {
      if (!category?.id) continue;
      categoryMap.set(category.id, {
        ...category,
        count: Number(category.count) || 0,
      });
    }
    for (const fallback of DEFAULT_CATEGORIES) {
      if (!categoryMap.has(fallback.id)) categoryMap.set(fallback.id, { ...fallback, count: 0 });
    }
    for (const site of sites) {
      if (!categoryMap.has(site.category)) {
        categoryMap.set(site.category, {
          id: site.category,
          name: site.category,
          emoji: '✨',
          count: 0,
        });
      }
    }
    for (const category of categoryMap.values()) {
      category.count = sites.filter((site) => site.category === category.id).length;
    }

    return {
      ...data,
      site: {
        name: 'Container Hub',
        title: 'AI 工具导航',
        repo: 'https://github.com/flairamos/container-hub',
        ...(data.site || {}),
      },
      categories: [...categoryMap.values()],
      sites,
      popular: Array.isArray(data.popular) ? data.popular : [],
      stats: data.stats || {},
    };
  }

  function categoryName(id) {
    if (id === 'all') return '全部';
    return state.categories.find((category) => category.id === id)?.name || id;
  }

  function updateHero() {
    const data = state.data;
    const sites = state.sites;
    document.title = `${data.site.name} · ${data.site.title}`;

    const total = data.stats.total ?? sites.length;
    const usedCategories = state.categories.filter((category) => category.count > 0).length;
    const newThisWeek =
      data.stats.newThisWeek ??
      sites.filter((site) => !site.seeded && isRecent(site.firstSeenAt, 7)).length;

    document.querySelector('[data-stat="total"]').textContent = formatNumber(total);
    document.querySelector('[data-stat="categories"]').textContent = formatNumber(usedCategories);
    document.querySelector('[data-stat="new"]').textContent = formatNumber(newThisWeek);

    const updated = data.updatedAt || data.generatedAt;
    if (updated) {
      els.updateHint.textContent = `每日自动更新 · ${formatDate(updated)} 更新`;
    }

    if (data.site.repo) {
      const repo = safeUrl(data.site.repo);
      els.repoLink.href = repo;
      els.footerRepo.href = repo;
    }
    els.year.textContent = String(new Date().getFullYear());
  }

  function renderTabs() {
    const fragment = document.createDocumentFragment();
    const all = {
      id: 'all',
      name: '全部',
      count: state.sites.length,
    };
    const list = [all, ...state.categories.filter((category) => category.count > 0)];

    for (const category of list) {
      const button = element('button', 'tab');
      button.type = 'button';
      button.dataset.cat = category.id;
      button.setAttribute('aria-pressed', String(state.cat === category.id));
      if (state.cat === category.id) button.classList.add('is-active');
      button.append(document.createTextNode(category.name));
      const count = element('span', 'tab-count', formatNumber(category.count));
      button.append(count);
      fragment.append(button);
    }
    els.tabs.replaceChildren(fragment);
  }

  function matchesQuery(site, tokens) {
    if (!tokens.length) return true;
    const haystack = [
      site.title,
      site.description,
      site.domain,
      site.category,
      categoryName(site.category),
      ...(site.tags || []),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return tokens.every((token) => haystack.includes(token));
  }

  function filterSites() {
    const tokens = state.q
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    return state.sites
      .filter((site) => state.cat === 'all' || site.category === state.cat)
      .filter((site) => matchesQuery(site, tokens));
  }

  function getPopular() {
    const byId = new Map(state.sites.map((site) => [site.id, site]));
    const ids = new Set(state.data.popular || []);
    let popular = [...ids]
      .map((id) => byId.get(id))
      .filter(Boolean)
      .filter((site) => site.status !== 'offline');

    if (popular.length < 6) {
      const selected = new Set(popular.map((site) => site.id));
      const extra = [...state.sites]
        .filter((site) => site.status !== 'offline' && !selected.has(site.id))
        .sort((a, b) => (b.score || 0) - (a.score || 0));
      popular = popular.concat(extra);
    }
    return popular.slice(0, 12);
  }

  function createCard(site, eager = false) {
    const card = element('a', 'tool-card');
    if (site.status === 'offline') card.classList.add('is-offline');
    card.href = safeUrl(site.url);
    card.target = '_blank';
    card.rel = 'noopener noreferrer';
    card.dataset.category = site.category;
    card.setAttribute('aria-label', `${site.title}：${site.description || ''}`);

    const icon = element('span', 'tool-icon');
    const [c1, c2] = colorFor(site.domain || site.title);
    icon.style.setProperty('--c1', c1);
    icon.style.setProperty('--c2', c2);
    const letter = element('span', 'tool-icon-letter', firstCharacter(site.title));
    icon.append(letter);

    const iconUrl = safeIconUrl(site.icon);
    if (iconUrl) {
      const image = document.createElement('img');
      image.src = iconUrl;
      image.alt = '';
      image.loading = eager ? 'eager' : 'lazy';
      image.decoding = 'async';
      image.addEventListener(
        'error',
        () => {
          image.remove();
        },
        { once: true },
      );
      icon.append(image);
    }

    const body = element('span', 'tool-body');
    const nameRow = element('span', 'tool-name-row');
    const name = element('span', 'tool-name', site.title);
    name.title = site.title;
    nameRow.append(name);

    if (site.isNew) {
      nameRow.append(element('span', 'badge-new', 'NEW'));
    }
    if (site.status === 'offline') {
      nameRow.append(element('span', 'badge-offline', '离线'));
    }

    const description = element('span', 'tool-desc', site.description || '');
    description.title = site.description || '';
    body.append(nameRow, description);
    card.append(icon, body);
    return card;
  }

  function createSection({ title, emoji, icon, note, sites, id, eagerCount = 0, limit = 0 }) {
    const section = element('section', 'section');
    if (id) section.id = `section-${id}`;

    const head = element('div', 'section-head');
    const pill = element('h2', 'section-pill');
    if (icon === 'flame') {
      const holder = element('span');
      holder.innerHTML = FLAME_SVG;
      holder.setAttribute('aria-hidden', 'true');
      pill.append(holder);
    } else if (icon === 'search') {
      const holder = element('span');
      holder.innerHTML = SEARCH_SVG;
      holder.setAttribute('aria-hidden', 'true');
      pill.append(holder);
    } else {
      pill.append(element('span', 'emoji', emoji || '✨'));
    }
    pill.append(document.createTextNode(title));
    pill.append(element('span', 'section-count', formatNumber(sites.length)));
    head.append(pill);
    if (note) head.append(element('span', 'section-note', note));

    const grid = element('div', 'tool-grid');
    const initial = limit > 0 ? sites.slice(0, limit) : sites;
    initial.forEach((site, index) => {
      grid.append(createCard(site, index < eagerCount));
    });

    section.append(head, grid);

    if (limit > 0 && sites.length > limit) {
      let expanded = false;
      const more = element('button', 'section-more', `展开全部 ${sites.length} 个`);
      more.type = 'button';
      more.setAttribute('aria-expanded', 'false');
      more.addEventListener('click', () => {
        if (!expanded) {
          for (const site of sites.slice(limit)) {
            grid.append(createCard(site, false));
          }
          more.textContent = '收起';
          more.setAttribute('aria-expanded', 'true');
          expanded = true;
        } else {
          while (grid.children.length > limit) {
            grid.lastElementChild?.remove();
          }
          more.textContent = `展开全部 ${sites.length} 个`;
          more.setAttribute('aria-expanded', 'false');
          expanded = false;
        }
      });
      section.append(more);
    }

    return section;
  }

  function renderEmpty(title, description) {
    const empty = element('div', 'empty');
    empty.append(element('h3', 'empty-title', title));
    empty.append(element('p', 'empty-desc', description));
    const button = element('button', 'reset-button', '清除筛选');
    button.type = 'button';
    button.addEventListener('click', () => {
      state.q = '';
      state.cat = 'all';
      els.search.value = '';
      renderTabs();
      render();
      els.search.focus();
    });
    empty.append(button);
    return empty;
  }

  function render() {
    const q = state.q.trim();
    const filtered = filterSites();
    const fragment = document.createDocumentFragment();

    if (!state.sites.length) {
      fragment.append(renderEmpty('还没有收录数据', '先运行 npm run crawl 生成 data/data.json。'));
      els.content.replaceChildren(fragment);
      return;
    }

    if (q) {
      if (filtered.length) {
        const title =
          state.cat === 'all' ? '搜索结果' : `${categoryName(state.cat)} · 搜索结果`;
        fragment.append(
          createSection({
            title,
            icon: 'search',
            note: `关键词 “${q}” · ${filtered.length} 个结果`,
            sites: filtered,
            eagerCount: 6,
            limit: 24,
          }),
        );
      } else {
        fragment.append(
          renderEmpty('没有匹配的工具', `没有找到与 “${q}” 相关的站点，换个关键词试试。`),
        );
      }
    } else if (state.cat !== 'all') {
      const sites = filtered;
      if (sites.length) {
        fragment.append(
          createSection({
            title: categoryName(state.cat),
            emoji: state.categories.find((category) => category.id === state.cat)?.emoji,
            note: `${sites.length} 个站点 · 按热度排序`,
            sites,
            id: state.cat,
            eagerCount: 6,
            limit: 12,
          }),
        );
      } else {
        fragment.append(renderEmpty('这个分类暂时没有工具', '换一个分类，或清除筛选看看全部。'));
      }
    } else {
      const popular = getPopular();
      if (popular.length) {
        fragment.append(
          createSection({
            title: '热门工具',
            icon: 'flame',
            note: '按综合热度排序',
            sites: popular,
            eagerCount: 6,
            limit: 12,
          }),
        );
      }

      for (const category of state.categories) {
        if (!category.count) continue;
        const sites = state.sites
          .filter((site) => site.category === category.id)
          .sort((a, b) => (b.score || 0) - (a.score || 0));
        if (!sites.length) continue;
        fragment.append(
          createSection({
            title: category.name,
            emoji: category.emoji,
            note: `${sites.length} 个站点`,
            sites,
            id: category.id,
            eagerCount: 0,
            limit: 12,
          }),
        );
      }
    }

    els.content.replaceChildren(fragment);
  }

  function renderError(error) {
    const notice = element('div', 'notice');
    notice.append(element('strong', '', '数据加载失败'));
    notice.append(document.createElement('br'));
    notice.append(
      document.createTextNode(
        `${error.message || '未知错误'}。请确认通过本地服务器访问（npm run dev），而不是直接双击 index.html。`,
      ),
    );
    els.content.replaceChildren(notice);
  }

  function bindEvents() {
    els.search.addEventListener('input', () => {
      window.clearTimeout(state.searchTimer);
      state.searchTimer = window.setTimeout(() => {
        state.q = els.search.value;
        render();
      }, 80);
    });

    els.tabs.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-cat]');
      if (!button) return;
      const next = button.dataset.cat;
      if (next === state.cat) return;
      state.cat = next;
      renderTabs();
      render();
      // renderTabs 会重建按钮，键盘操作时把焦点还给当前 tab。
      [...els.tabs.querySelectorAll('button[data-cat]')]
        .find((item) => item.dataset.cat === next)
        ?.focus();
    });

    document.addEventListener('keydown', (event) => {
      const target = event.target;
      const isEditing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable;

      if (event.key === '/' && !isEditing) {
        event.preventDefault();
        els.search.focus();
        els.search.select();
      }
      if (event.key === 'Escape') {
        if (document.activeElement === els.search) {
          if (els.search.value) {
            els.search.value = '';
            state.q = '';
            render();
          } else {
            els.search.blur();
          }
        }
      }
    });
  }

  async function init() {
    els.year.textContent = String(new Date().getFullYear());
    bindEvents();
    try {
      const response = await fetch('data/data.json', { cache: 'no-cache' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      state.data = normalizeData(await response.json());
      state.sites = state.data.sites;
      state.categories = state.data.categories;
      updateHero();
      renderTabs();
      render();
    } catch (error) {
      renderError(error);
    }
  }

  init();
})();
