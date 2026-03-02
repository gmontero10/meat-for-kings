/* ==========================================================================
   Meat for Kings — Frontend Application
   ========================================================================== */
(function () {
  'use strict';

  // -----------------------------------------------------------------------
  // State
  // -----------------------------------------------------------------------
  const state = {
    products: [],
    filters: {
      search: '',
      categories: [],
      fuelTypes: [],
      minPrice: null,
      maxPrice: null,
      inStock: false,
      hasRating: false,
    },
    sort: 'price_asc',
    page: 1,
    perPage: 36,
    totalProducts: 0,
    totalPages: 0,
    isLoading: false,
    hasMore: true,
    filterMeta: null, // from /api/filters
  };

  // -----------------------------------------------------------------------
  // DOM refs
  // -----------------------------------------------------------------------
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const dom = {
    searchInput:      $('#search-input'),
    searchClear:      $('#search-clear'),
    resultCount:      $('#result-count'),
    sortSelect:       $('#sort-select'),
    filterSidebar:    $('#filter-sidebar'),
    sidebarOverlay:   $('#sidebar-overlay'),
    sidebarClose:     $('#sidebar-close'),
    mobileFilterBtn:  $('#mobile-filter-btn'),
    activeFilters:    $('#active-filters'),
    filterTags:       $('#filter-tags'),
    clearAll:         $('#clear-all-filters'),
    minPrice:         $('#min-price'),
    maxPrice:         $('#max-price'),
    categoryList:     $('#category-list'),
    fuelTypeList:     $('#fuel-type-list'),
    inStockToggle:    $('#in-stock-toggle'),
    hasRatingToggle:  $('#has-rating-toggle'),
    productGrid:      $('#product-grid'),
    skeletonGrid:     $('#skeleton-grid'),
    scrollSentinel:   $('#scroll-sentinel'),
    emptyState:       $('#empty-state'),
    emptyClear:       $('#empty-clear-filters'),
    modal:            $('#product-modal'),
    modalBody:        $('#modal-body'),
    modalClose:       $('#modal-close'),
    backToTop:        $('#back-to-top'),
  };

  // -----------------------------------------------------------------------
  // API Module
  // -----------------------------------------------------------------------
  let searchController = null;

  const api = {
    async getFilters() {
      const res = await fetch('/api/filters');
      return res.json();
    },

    async getProducts(params = {}) {
      // Cancel previous in-flight search request
      if (searchController) searchController.abort();
      searchController = new AbortController();

      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(params)) {
        if (v !== null && v !== undefined && v !== '') qs.set(k, v);
      }
      const res = await fetch(`/api/products?${qs}`, { signal: searchController.signal });
      return res.json();
    },

    async getProduct(id) {
      const res = await fetch(`/api/products/${id}`);
      return res.json();
    },
  };

  // -----------------------------------------------------------------------
  // Render Module
  // -----------------------------------------------------------------------
  const PLACEHOLDER_GIF = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

  function escapeHtml(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  const ALLOWED_TAGS = new Set([
    'h3', 'h4', 'p', 'b', 'strong', 'em', 'br', 'ul', 'li', 'ol',
  ]);

  function sanitizeHtml(html) {
    if (!html) return '';
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    function walk(node) {
      const out = [];
      for (const child of node.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
          out.push(escapeHtml(child.textContent));
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          const tag = child.tagName.toLowerCase();
          if (ALLOWED_TAGS.has(tag)) {
            const inner = walk(child);
            if (tag === 'br') {
              out.push('<br>');
            } else {
              out.push(`<${tag}>${inner}</${tag}>`);
            }
          } else {
            // unwrap: keep children
            out.push(walk(child));
          }
        }
      }
      return out.join('');
    }
    return walk(doc.body);
  }

  function formatPrice(cents) {
    if (cents == null) return '';
    return '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }

  function starRating(rating, count) {
    if (rating == null) return '';
    const pct = Math.round((rating / 5) * 100);
    const countStr = count ? `(${count})` : '';
    return `
      <div class="star-rating">
        <span class="stars">
          <span class="stars-empty">\u2605\u2605\u2605\u2605\u2605</span>
          <span class="stars-filled" style="width:${pct}%">\u2605\u2605\u2605\u2605\u2605</span>
        </span>
        <span class="star-count">${rating.toFixed(1)} ${escapeHtml(countStr)}</span>
      </div>`;
  }

  function productCard(p) {
    const savingsNum = p.savings_percent ? parseInt(p.savings_percent, 10) : 0;
    const savingsBadge = savingsNum > 0
      ? `<span class="savings-badge">Save ${escapeHtml(p.savings_percent)}</span>`
      : '';

    const retailPrice = p.price_retail && p.price_retail !== p.price_current
      ? `<span class="price-retail">${formatPrice(p.price_retail)}</span>`
      : '';

    const savingsText = savingsNum > 0 && p.savings_formatted
      ? `<span class="price-savings">Save ${escapeHtml(p.savings_formatted)}</span>`
      : '';

    let footerBadges = '';
    if (p.is_free_shipping) {
      footerBadges += '<span class="badge badge-shipping">Free Shipping</span>';
    }
    if (p.fuel_type) {
      footerBadges += `<span class="badge badge-fuel">${escapeHtml(p.fuel_type)}</span>`;
    }
    if (p.stock_status === 'IN_STOCK') {
      footerBadges += '<span class="badge badge-stock">In Stock</span>';
    } else if (p.stock_status === 'OUT_OF_STOCK') {
      footerBadges += '<span class="badge badge-oos">Out of Stock</span>';
    }

    return `
      <article class="product-card" tabindex="0" data-id="${escapeHtml(String(p.id))}" role="button" aria-label="${escapeHtml(p.name)}">
        ${savingsBadge}
        <div class="card-image-wrap">
          <img data-src="${escapeHtml(p.image_url)}" src="${PLACEHOLDER_GIF}" alt="${escapeHtml(p.name)}" loading="lazy">
        </div>
        <div class="card-body">
          <div class="card-brand">${escapeHtml(p.brand || '')}</div>
          <h3 class="card-name">${escapeHtml(p.name)}</h3>
          ${starRating(p.rating, p.review_count)}
          <div class="card-pricing">
            <span class="price-current">${formatPrice(p.price_current)}</span>
            ${retailPrice}
            ${savingsText}
          </div>
          <div class="card-footer">
            ${footerBadges}
          </div>
        </div>
      </article>`;
  }

  function skeletonCards(n) {
    let html = '';
    for (let i = 0; i < n; i++) {
      html += `
        <div class="skeleton-card">
          <div class="skeleton-image"></div>
          <div class="skeleton-body">
            <div class="skeleton-line w60"></div>
            <div class="skeleton-line w80 h16"></div>
            <div class="skeleton-line w80"></div>
            <div class="skeleton-line w40 h20"></div>
            <div class="skeleton-line w50"></div>
          </div>
        </div>`;
    }
    return html;
  }

  // -----------------------------------------------------------------------
  // Lazy Image Observer
  // -----------------------------------------------------------------------
  const imageObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          const img = entry.target;
          if (img.dataset.src) {
            img.src = img.dataset.src;
            img.removeAttribute('data-src');
          }
          imageObserver.unobserve(img);
        }
      }
    },
    { rootMargin: '300px' }
  );

  function observeNewImages() {
    dom.productGrid.querySelectorAll('img[data-src]').forEach((img) => {
      imageObserver.observe(img);
    });
  }

  // -----------------------------------------------------------------------
  // Core data loading
  // -----------------------------------------------------------------------
  function buildParams() {
    const p = {
      page: state.page,
      per_page: state.perPage,
      sort: state.sort,
    };
    if (state.filters.search) p.search = state.filters.search;

    if (state.filters.categories.length) p.category = state.filters.categories.join(',');
    if (state.filters.fuelTypes.length) p.fuel_type = state.filters.fuelTypes.join(',');
    if (state.filters.minPrice != null) p.min_price = state.filters.minPrice;
    if (state.filters.maxPrice != null) p.max_price = state.filters.maxPrice;
    if (state.filters.inStock) p.in_stock = '1';
    if (state.filters.hasRating) p.has_rating = '1';
    return p;
  }

  function showSkeletons() {
    dom.skeletonGrid.innerHTML = skeletonCards(12);
    dom.skeletonGrid.hidden = false;
  }

  function hideSkeletons() {
    dom.skeletonGrid.hidden = true;
    dom.skeletonGrid.innerHTML = '';
  }

  async function loadProducts(append = false) {
    if (state.isLoading) return;
    state.isLoading = true;

    if (!append) showSkeletons();

    try {
      const data = await api.getProducts(buildParams());
      state.totalProducts = data.total;
      state.totalPages = data.total_pages;
      state.hasMore = state.page < data.total_pages;

      if (!append) {
        state.products = data.products;
        dom.productGrid.innerHTML = data.products.map(productCard).join('');
      } else {
        state.products.push(...data.products);
        dom.productGrid.insertAdjacentHTML('beforeend', data.products.map(productCard).join(''));
      }

      observeNewImages();
      updateResultCount();

      // Show / hide empty state
      if (state.products.length === 0 && state.page === 1) {
        dom.emptyState.hidden = false;
        dom.productGrid.hidden = true;
      } else {
        dom.emptyState.hidden = true;
        dom.productGrid.hidden = false;
      }
    } catch (err) {
      if (err.name === 'AbortError') return; // search cancelled
      console.error('Failed to load products:', err);
    } finally {
      state.isLoading = false;
      hideSkeletons();
    }
  }

  function resetAndReload() {
    state.page = 1;
    state.hasMore = true;
    state.products = [];
    dom.productGrid.innerHTML = '';
    dom.emptyState.hidden = true;
    dom.productGrid.hidden = false;
    loadProducts(false);
  }

  function updateResultCount() {
    const n = state.totalProducts;
    dom.resultCount.textContent = `${n.toLocaleString()} grill${n !== 1 ? 's' : ''}`;
  }

  // -----------------------------------------------------------------------
  // Infinite Scroll
  // -----------------------------------------------------------------------
  const scrollObserver = new IntersectionObserver(
    (entries) => {
      if (entries[0].isIntersecting && state.hasMore && !state.isLoading) {
        state.page++;
        loadProducts(true);
      }
    },
    { rootMargin: '200px' }
  );

  // -----------------------------------------------------------------------
  // Filter sidebar population
  // -----------------------------------------------------------------------
  function populateCategories(categories) {
    dom.categoryList.innerHTML = categories
      .map(
        (c) => `
        <label class="checkbox-item">
          <input type="checkbox" value="${escapeHtml(c)}" class="category-cb">
          <span class="cb-label">${escapeHtml(c)}</span>
        </label>`
      )
      .join('');
  }

  function populateFuelTypes(types) {
    dom.fuelTypeList.innerHTML = types
      .map(
        (t) => `
        <label class="checkbox-item">
          <input type="checkbox" value="${escapeHtml(t)}" class="fuel-cb">
          <span class="cb-label">${escapeHtml(t)}</span>
        </label>`
      )
      .join('');
  }

  // -----------------------------------------------------------------------
  // Active filter tags
  // -----------------------------------------------------------------------
  function updateFilterTags() {
    const tags = [];

    if (state.filters.search) {
      tags.push({ label: `"${state.filters.search}"`, type: 'search' });
    }
    for (const c of state.filters.categories) {
      tags.push({ label: c, type: 'category', value: c });
    }
    for (const f of state.filters.fuelTypes) {
      tags.push({ label: f, type: 'fuel', value: f });
    }
    if (state.filters.minPrice != null || state.filters.maxPrice != null) {
      const min = state.filters.minPrice != null ? formatPrice(state.filters.minPrice) : '$0';
      const max = state.filters.maxPrice != null ? formatPrice(state.filters.maxPrice) : 'Any';
      tags.push({ label: `${min} – ${max}`, type: 'price' });
    }
    if (state.filters.inStock) {
      tags.push({ label: 'In Stock', type: 'inStock' });
    }
    if (state.filters.hasRating) {
      tags.push({ label: 'Has Rating', type: 'hasRating' });
    }

    dom.activeFilters.hidden = tags.length === 0;
    dom.filterTags.innerHTML = tags
      .map(
        (t) => `<span class="filter-tag" data-type="${t.type}" data-value="${escapeHtml(t.value || '')}">
          ${escapeHtml(t.label)}
          <button class="tag-remove" aria-label="Remove filter">&times;</button>
        </span>`
      )
      .join('');
  }

  function removeFilter(type, value) {
    switch (type) {
      case 'search':
        state.filters.search = '';
        dom.searchInput.value = '';
        dom.searchClear.hidden = true;
        break;
      case 'category':
        state.filters.categories = state.filters.categories.filter((c) => c !== value);
        const cc = dom.categoryList.querySelector(`input[value="${CSS.escape(value)}"]`);
        if (cc) cc.checked = false;
        break;
      case 'fuel':
        state.filters.fuelTypes = state.filters.fuelTypes.filter((f) => f !== value);
        const fc = dom.fuelTypeList.querySelector(`input[value="${CSS.escape(value)}"]`);
        if (fc) fc.checked = false;
        break;
      case 'price':
        state.filters.minPrice = null;
        state.filters.maxPrice = null;
        dom.minPrice.value = '';
        dom.maxPrice.value = '';
        $$('.preset-btn').forEach((b) => b.classList.remove('active'));
        break;
      case 'inStock':
        state.filters.inStock = false;
        dom.inStockToggle.checked = false;
        break;
      case 'hasRating':
        state.filters.hasRating = false;
        dom.hasRatingToggle.checked = false;
        break;
    }
    updateFilterTags();
    resetAndReload();
  }

  function clearAllFilters() {
    state.filters = {
      search: '',
      categories: [],
      fuelTypes: [],
      minPrice: null,
      maxPrice: null,
      inStock: false,
      hasRating: false,
    };
    dom.searchInput.value = '';
    dom.searchClear.hidden = true;
    dom.minPrice.value = '';
    dom.maxPrice.value = '';
    dom.inStockToggle.checked = false;
    dom.hasRatingToggle.checked = false;
    dom.categoryList.querySelectorAll('input:checked').forEach((cb) => (cb.checked = false));
    dom.fuelTypeList.querySelectorAll('input:checked').forEach((cb) => (cb.checked = false));
    $$('.preset-btn').forEach((b) => b.classList.remove('active'));
    updateFilterTags();
    resetAndReload();
  }

  // -----------------------------------------------------------------------
  // Modal
  // -----------------------------------------------------------------------
  let lastFocusedElement = null;

  async function openModal(productId) {
    lastFocusedElement = document.activeElement;
    dom.modal.hidden = false;
    dom.modalBody.innerHTML = '<div style="padding:60px;text-align:center;color:var(--text-tertiary)">Loading...</div>';

    // trigger reflow for animation
    void dom.modal.offsetHeight;
    dom.modal.classList.add('active');
    document.body.style.overflow = 'hidden';

    try {
      const p = await api.getProduct(productId);
      if (p.error) {
        dom.modalBody.innerHTML = '<div style="padding:40px;text-align:center;">Product not found.</div>';
        return;
      }
      renderModal(p);
    } catch (err) {
      console.error('Failed to load product:', err);
      dom.modalBody.innerHTML = '<div style="padding:40px;text-align:center;">Failed to load product.</div>';
    }
  }

  function renderModal(p) {
    const savingsNum = p.savings_percent ? parseInt(p.savings_percent, 10) : 0;

    // Rating
    let ratingHtml = '';
    if (p.rating != null) {
      const pct = Math.round((p.rating / 5) * 100);
      ratingHtml = `
        <div class="modal-rating">
          <span class="stars">
            <span class="stars-empty">\u2605\u2605\u2605\u2605\u2605</span>
            <span class="stars-filled" style="width:${pct}%">\u2605\u2605\u2605\u2605\u2605</span>
          </span>
          <span class="star-text">${p.rating.toFixed(1)} out of 5${p.review_count ? ` (${p.review_count} review${p.review_count !== 1 ? 's' : ''})` : ''}</span>
        </div>`;
    }

    // Pricing
    const retailHtml = p.price_retail && p.price_retail !== p.price_current
      ? `<span class="modal-price-retail">${formatPrice(p.price_retail)}</span>`
      : '';
    const savingsHtml = savingsNum > 0 && p.savings_formatted
      ? `<span class="modal-savings">Save ${escapeHtml(p.savings_formatted)} (${escapeHtml(p.savings_percent)})</span>`
      : '';

    // Badges
    let badges = '';
    if (p.is_free_shipping) badges += '<span class="badge badge-shipping">Free Shipping</span>';
    if (p.fuel_type) badges += `<span class="badge badge-fuel">${escapeHtml(p.fuel_type)}</span>`;
    if (p.stock_status === 'IN_STOCK') badges += '<span class="badge badge-stock">In Stock</span>';
    else if (p.stock_status === 'OUT_OF_STOCK') badges += '<span class="badge badge-oos">Out of Stock</span>';
    if (p.ships_in) badges += `<span class="badge badge-fuel">Ships in ${escapeHtml(p.ships_in)}</span>`;

    // Description
    let descHtml = '';
    if (p.description) {
      descHtml = `
        <div class="modal-section">
          <h4 class="modal-section-title">Description</h4>
          <div class="modal-description">${sanitizeHtml(p.description)}</div>
        </div>`;
    }

    // Bullet points
    let bulletsHtml = '';
    if (p.bullet_points && p.bullet_points.length > 0) {
      const items = p.bullet_points.map((b) => `<li>${escapeHtml(b)}</li>`).join('');
      bulletsHtml = `
        <div class="modal-section">
          <h4 class="modal-section-title">Key Features</h4>
          <ul class="modal-bullets">${items}</ul>
        </div>`;
    }

    // Specs table
    const specs = [];
    if (p.brand) specs.push(['Brand', p.brand]);
    if (p.model_number) specs.push(['Model', p.model_number]);
    if (p.category) specs.push(['Category', p.category]);
    if (p.fuel_type) specs.push(['Fuel Type', p.fuel_type]);

    let specsHtml = '';
    if (specs.length > 0) {
      const rows = specs.map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td>${escapeHtml(v)}</td></tr>`).join('');
      specsHtml = `
        <div class="modal-section">
          <h4 class="modal-section-title">Specifications</h4>
          <table class="modal-specs">${rows}</table>
        </div>`;
    }

    // Product URL
    let productUrl = p.product_url || '';
    if (productUrl && !productUrl.startsWith('http')) {
      productUrl = 'https://www.bbqguys.com' + productUrl;
    }
    const ctaHtml = productUrl
      ? `<a href="${escapeHtml(productUrl)}" target="_blank" rel="noopener noreferrer" class="modal-cta">
          View on BBQGuys
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
        </a>`
      : '';

    dom.modalBody.innerHTML = `
      <div class="modal-grid">
        <div class="modal-image-wrap">
          <img src="${escapeHtml(p.image_url || '')}" alt="${escapeHtml(p.name)}">
        </div>
        <div class="modal-info">
          <div class="modal-brand">${escapeHtml(p.brand || '')}</div>
          <h2 class="modal-name">${escapeHtml(p.name)}</h2>
          ${ratingHtml}
          <div class="modal-pricing">
            <span class="modal-price-current">${formatPrice(p.price_current)}</span>
            ${retailHtml}
            <br>
            ${savingsHtml}
          </div>
          <div class="modal-badges">${badges}</div>
          ${descHtml}
          ${bulletsHtml}
          ${specsHtml}
          ${ctaHtml}
        </div>
      </div>`;
  }

  function closeModal() {
    dom.modal.classList.remove('active');
    document.body.style.overflow = '';
    // Wait for transition
    setTimeout(() => {
      dom.modal.hidden = true;
      dom.modalBody.innerHTML = '';
    }, 300);
    if (lastFocusedElement) lastFocusedElement.focus();
  }

  // -----------------------------------------------------------------------
  // Event handlers
  // -----------------------------------------------------------------------

  // Debounce utility
  function debounce(fn, ms) {
    let timer;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  function bindEvents() {
    // --- Search ---
    const debouncedSearch = debounce(() => {
      state.filters.search = dom.searchInput.value.trim();
      dom.searchClear.hidden = !state.filters.search;
      updateFilterTags();
      resetAndReload();
    }, 300);

    dom.searchInput.addEventListener('input', debouncedSearch);

    dom.searchClear.addEventListener('click', () => {
      dom.searchInput.value = '';
      state.filters.search = '';
      dom.searchClear.hidden = true;
      updateFilterTags();
      resetAndReload();
    });

    // --- Sort ---
    dom.sortSelect.addEventListener('change', () => {
      state.sort = dom.sortSelect.value;
      resetAndReload();
    });

    // --- Price inputs ---
    const debouncedPrice = debounce(() => {
      const minVal = dom.minPrice.value.trim();
      const maxVal = dom.maxPrice.value.trim();
      state.filters.minPrice = minVal ? parseInt(minVal, 10) * 100 : null;
      state.filters.maxPrice = maxVal ? parseInt(maxVal, 10) * 100 : null;
      // Deactivate preset buttons
      $$('.preset-btn').forEach((b) => b.classList.remove('active'));
      updateFilterTags();
      resetAndReload();
    }, 500);

    dom.minPrice.addEventListener('input', debouncedPrice);
    dom.maxPrice.addEventListener('input', debouncedPrice);

    // --- Price presets ---
    $$('.preset-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const isActive = btn.classList.contains('active');
        $$('.preset-btn').forEach((b) => b.classList.remove('active'));
        if (isActive) {
          // Deselect
          state.filters.minPrice = null;
          state.filters.maxPrice = null;
          dom.minPrice.value = '';
          dom.maxPrice.value = '';
        } else {
          btn.classList.add('active');
          const minVal = btn.dataset.min;
          const maxVal = btn.dataset.max;
          state.filters.minPrice = minVal ? parseInt(minVal, 10) : null;
          state.filters.maxPrice = maxVal ? parseInt(maxVal, 10) : null;
          dom.minPrice.value = minVal ? parseInt(minVal, 10) / 100 : '';
          dom.maxPrice.value = maxVal ? parseInt(maxVal, 10) / 100 : '';
        }
        updateFilterTags();
        resetAndReload();
      });
    });

    // --- Category checkboxes ---
    dom.categoryList.addEventListener('change', (e) => {
      if (!e.target.classList.contains('category-cb')) return;
      const val = e.target.value;
      if (e.target.checked) {
        if (!state.filters.categories.includes(val)) state.filters.categories.push(val);
      } else {
        state.filters.categories = state.filters.categories.filter((c) => c !== val);
      }
      updateFilterTags();
      resetAndReload();
    });

    // --- Fuel type checkboxes ---
    dom.fuelTypeList.addEventListener('change', (e) => {
      if (!e.target.classList.contains('fuel-cb')) return;
      const val = e.target.value;
      if (e.target.checked) {
        if (!state.filters.fuelTypes.includes(val)) state.filters.fuelTypes.push(val);
      } else {
        state.filters.fuelTypes = state.filters.fuelTypes.filter((f) => f !== val);
      }
      updateFilterTags();
      resetAndReload();
    });

    // --- Toggle switches ---
    dom.inStockToggle.addEventListener('change', () => {
      state.filters.inStock = dom.inStockToggle.checked;
      updateFilterTags();
      resetAndReload();
    });

    dom.hasRatingToggle.addEventListener('change', () => {
      state.filters.hasRating = dom.hasRatingToggle.checked;
      updateFilterTags();
      resetAndReload();
    });

    // --- Active filter tag removal ---
    dom.filterTags.addEventListener('click', (e) => {
      const removeBtn = e.target.closest('.tag-remove');
      if (!removeBtn) return;
      const tag = removeBtn.closest('.filter-tag');
      removeFilter(tag.dataset.type, tag.dataset.value);
    });

    // --- Clear all ---
    dom.clearAll.addEventListener('click', clearAllFilters);
    dom.emptyClear.addEventListener('click', clearAllFilters);

    // --- Card clicks (event delegation) ---
    dom.productGrid.addEventListener('click', (e) => {
      const card = e.target.closest('.product-card');
      if (card) openModal(card.dataset.id);
    });

    dom.productGrid.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        const card = e.target.closest('.product-card');
        if (card) {
          e.preventDefault();
          openModal(card.dataset.id);
        }
      }
    });

    // --- Modal close ---
    dom.modalClose.addEventListener('click', closeModal);
    dom.modal.addEventListener('click', (e) => {
      if (e.target === dom.modal) closeModal();
    });

    // --- Keyboard: Escape ---
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && dom.modal.classList.contains('active')) {
        closeModal();
      }
    });

    // --- Mobile filter toggle ---
    dom.mobileFilterBtn.addEventListener('click', () => {
      dom.filterSidebar.classList.add('open');
      dom.sidebarOverlay.classList.add('active');
    });

    dom.sidebarClose.addEventListener('click', closeSidebar);
    dom.sidebarOverlay.addEventListener('click', closeSidebar);

    function closeSidebar() {
      dom.filterSidebar.classList.remove('open');
      dom.sidebarOverlay.classList.remove('active');
    }

    // --- Back to top ---
    window.addEventListener('scroll', () => {
      if (window.scrollY > 800) {
        dom.backToTop.classList.add('visible');
        dom.backToTop.hidden = false;
      } else {
        dom.backToTop.classList.remove('visible');
      }
    }, { passive: true });

    dom.backToTop.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  // -----------------------------------------------------------------------
  // Init
  // -----------------------------------------------------------------------
  async function init() {
    // Show skeletons immediately
    showSkeletons();

    // Bind events before data arrives
    bindEvents();

    // Start infinite scroll observer
    scrollObserver.observe(dom.scrollSentinel);

    try {
      const [filterData] = await Promise.all([
        api.getFilters(),
        loadProducts(false),
      ]);

      state.filterMeta = filterData;
      populateCategories(filterData.categories);
      populateFuelTypes(filterData.fuel_types);
    } catch (err) {
      console.error('Init failed:', err);
    }
  }

  // Kick off
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
