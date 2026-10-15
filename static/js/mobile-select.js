/**
 * Mobile custom select — filter-card style dropdown (single-select).
 *
 * MOBILE-ONLY: enhances <select data-mobile-select="Title"> below 768px.
 * The native select stays the source of truth: Apply sets its value and
 * dispatches `change`, so existing page logic keeps working unmodified.
 * On desktop (>768px) nothing is wrapped and the native select renders
 * exactly as before.
 */
(function (global) {
    'use strict';

    var MOBILE_QUERY = '(max-width: 768px)';
    var PLACEHOLDER = 'Select…';
    var instances = [];

    function isMobile() {
        return Boolean(global.matchMedia && global.matchMedia(MOBILE_QUERY).matches);
    }

    function selectedLabel(select) {
        try {
            var idx = select.selectedIndex;
            var opt = idx >= 0 && select.options ? select.options[idx] : null;
            var text = opt ? String(opt.textContent || opt.label || '').trim() : '';
            if (text) return text;
        } catch (_) {}
        return PLACEHOLDER;
    }

    function closeOthers(except) {
        instances.forEach(function (inst) {
            if (inst !== except && inst.panel.classList.contains('show')) closePanel(inst);
        });
    }

    function openPanel(inst) {
        if (inst.select.disabled) return;
        rebuildList(inst);
        closeOthers(inst);
        inst.panel.classList.add('show');
        inst.button.setAttribute('aria-expanded', 'true');
        positionPanel(inst);
        if (global.requestAnimationFrame) {
            global.requestAnimationFrame(function () {
                if (isOpen(inst)) positionPanel(inst);
            });
        }
    }

    /**
     * Anchor the fixed panel under the button (or above it when there is no
     * room below), clamped to the viewport with 12px margins. Re-run on
     * scroll/resize while open since the anchor moves with the page.
     */
    function positionPanel(inst) {
        try {
            var rect = inst.button.getBoundingClientRect();
            var vw = global.innerWidth || document.documentElement.clientWidth || 360;
            var vh = global.innerHeight || document.documentElement.clientHeight || 640;
            var width = Math.max(rect.width || 0, 240);
            width = Math.min(width, vw - 24);
            var left = Math.min(Math.max(rect.left || 0, 12), Math.max(12, vw - width - 12));
            var gap = 8;
            var top = (rect.bottom || 0) + gap;
            inst.panel.style.left = left + 'px';
            inst.panel.style.width = width + 'px';
            inst.panel.style.top = Math.max(8, Math.min(top, vh - 120)) + 'px';
            // Flip above the button when the panel would run off-screen.
            var overflow = inst.panel.getBoundingClientRect().bottom - (vh - 8);
            if (overflow > 0) {
                var above = (rect.top || 0) - inst.panel.offsetHeight - gap;
                if (above >= 8) inst.panel.style.top = above + 'px';
            }
        } catch (_) {
            /* leave panel where CSS put it */
        }
    }

    function closePanel(inst) {
        inst.panel.classList.remove('show');
        inst.button.setAttribute('aria-expanded', 'false');
    }

    function isOpen(inst) {
        return inst.panel.classList.contains('show');
    }

    function rebuildList(inst) {
        var select = inst.select;
        inst.list.innerHTML = '';
        var opts = [];
        try {
            opts = Array.prototype.slice.call(select.options || []);
        } catch (_) {
            opts = [];
        }
        if (!opts.length) {
            var empty = document.createElement('p');
            empty.className = 'mselect-empty';
            empty.textContent = 'No options available yet.';
            inst.list.appendChild(empty);
            return;
        }
        opts.forEach(function (opt) {
            if (opt.disabled) return;
            var row = document.createElement('div');
            row.className = 'mselect-option';
            row.setAttribute('role', 'option');
            var isActive = opt.value === select.value;
            row.setAttribute('data-active', isActive ? 'true' : 'false');
            row.setAttribute('aria-selected', isActive ? 'true' : 'false');

            var box = document.createElement('span');
            box.className = 'mselect-check';
            box.setAttribute('aria-hidden', 'true');

            var label = document.createElement('span');
            label.className = 'mselect-option__label';
            label.textContent = String(opt.textContent || opt.label || opt.value || '').trim();

            row.appendChild(box);
            row.appendChild(label);
            // Auto-apply on tap (like the native select): commit + close.
            row.addEventListener('click', function () {
                commitValue(inst, opt.value);
            });
            inst.list.appendChild(row);
        });
        var list = inst.list;
        if (list.scrollHeight > list.clientHeight) list.scrollTop = 0;
    }

    function refreshLabel(inst) {
        if (inst.labelEl) inst.labelEl.textContent = selectedLabel(inst.select);
        if (inst.button) {
            inst.button.disabled = Boolean(inst.select.disabled);
            inst.button.setAttribute('aria-disabled', inst.select.disabled ? 'true' : 'false');
        }
    }

    function commitValue(inst, value) {
        var select = inst.select;
        if (select.disabled) {
            closePanel(inst);
            return;
        }
        if (value !== select.value) {
            select.value = value;
            var evt = null;
            try {
                evt = new Event('change', { bubbles: true });
            } catch (_) {
                evt = document.createEvent('HTMLEvents');
                evt.initEvent('change', true, false);
            }
            select.dispatchEvent(evt);
        }
        refreshLabel(inst);
        closePanel(inst);
    }

    function enhance(select) {
        if (!select || select.dataset.mselectEnhanced === '1') return findInstance(select);
        var title = String(select.getAttribute('data-mobile-select') || 'Options').trim() || 'Options';

        var wrap = document.createElement('div');
        wrap.className = 'mselect';
        select.parentNode.insertBefore(wrap, select);
        wrap.appendChild(select);
        select.classList.add('mselect-native-hidden');

        var button = document.createElement('button');
        button.type = 'button';
        button.className = String(select.className || '').replace(/mselect-native-hidden/g, '').trim() + ' mselect-btn';
        button.setAttribute('aria-haspopup', 'listbox');
        button.setAttribute('aria-expanded', 'false');
        var ariaLabel = select.getAttribute('aria-label');
        if (ariaLabel) button.setAttribute('aria-label', ariaLabel);

        var labelEl = document.createElement('span');
        labelEl.className = 'mselect-btn__label';
        var chev = document.createElement('i');
        chev.className = 'bi bi-chevron-down mselect-btn__chev';
        chev.setAttribute('aria-hidden', 'true');
        button.appendChild(labelEl);
        button.appendChild(chev);
        wrap.appendChild(button);

        var panel = document.createElement('div');
        panel.className = 'mselect-panel';
        panel.setAttribute('role', 'listbox');

        var heading = document.createElement('h4');
        heading.className = 'mselect-title';
        heading.textContent = title;

        var list = document.createElement('div');
        list.className = 'mselect-list';

        panel.appendChild(heading);
        panel.appendChild(list);
        // NOTE: the panel is fixed-positioned (see positionPanel) but stays
        // in the wrapper DOM so outside-tap detection keeps working.
        wrap.appendChild(panel);

        var inst = {
            select: select,
            wrap: wrap,
            button: button,
            labelEl: labelEl,
            panel: panel,
            list: list,
            observer: null,
        };

        // Intercept programmatic `select.value = x` (entries/insights set the
        // month without firing change) so the button label stays in sync.
        try {
            var proto = Object.getPrototypeOf(select);
            var desc = proto && Object.getOwnPropertyDescriptor(proto, 'value');
            if (desc && typeof desc.set === 'function') {
                Object.defineProperty(select, 'value', {
                    configurable: true,
                    enumerable: true,
                    get: function () {
                        return desc.get.call(this);
                    },
                    set: function (v) {
                        desc.set.call(this, v);
                        refreshLabel(inst);
                    },
                });
            }
        } catch (_) {
            /* fall back to observers below */
        }

        select.addEventListener('change', function () {
            refreshLabel(inst);
        });

        try {
            inst.observer = new MutationObserver(function () {
                refreshLabel(inst);
            });
            inst.observer.observe(select, { childList: true, attributes: true, attributeFilter: ['disabled'] });
        } catch (_) {
            inst.observer = null;
        }

        button.addEventListener('click', function () {
            if (select.disabled) return;
            if (isOpen(inst)) closePanel(inst);
            else openPanel(inst);
        });
        panel.addEventListener('keydown', function (ev) {
            if (ev.key === 'Escape') closePanel(inst);
        });

        if (!enhance.docBound) {
            enhance.docBound = true;
            // Outside tap closes (panel is fixed, so test panel + button).
            document.addEventListener('pointerdown', function (ev) {
                instances.forEach(function (other) {
                    if (!isOpen(other)) return;
                    var t = ev.target;
                    var insidePanel = other.panel && other.panel.contains(t);
                    var insideButton = other.button && other.button.contains(t);
                    if (!insidePanel && !insideButton) closePanel(other);
                });
            });
            document.addEventListener('keydown', function (ev) {
                if (ev.key === 'Escape') {
                    instances.forEach(function (other) {
                        if (isOpen(other)) closePanel(other);
                    });
                }
            });
            // Keep open panels anchored while the page moves.
            var repositionOpen = function (ev) {
                instances.forEach(function (other) {
                    if (!isOpen(other)) return;
                    // Internal option-list scrolling must not move the panel.
                    if (ev && ev.target && other.panel && other.panel.contains(ev.target)) return;
                    positionPanel(other);
                });
            };
            global.addEventListener('resize', function () {
                repositionOpen(null);
            });
            document.addEventListener('scroll', repositionOpen, true);
        }

        select.dataset.mselectEnhanced = '1';
        instances.push(inst);
        refreshLabel(inst);
        return inst;
    }

    function findInstance(select) {
        for (var i = 0; i < instances.length; i += 1) {
            if (instances[i].select === select) return instances[i];
        }
        return null;
    }

    function teardown(select) {
        for (var i = instances.length - 1; i >= 0; i -= 1) {
            if (select && instances[i].select !== select) continue;
            var inst = instances[i];
            try {
                if (inst.observer) inst.observer.disconnect();
            } catch (_) {}
            try {
                delete inst.select.dataset.mselectEnhanced;
            } catch (_) {}
            inst.select.classList.remove('mselect-native-hidden');
            // Unwrap: move the select back, drop button + panel + wrapper.
            var wrap = inst.wrap;
            if (wrap && wrap.parentNode) {
                wrap.parentNode.insertBefore(inst.select, wrap);
                wrap.parentNode.removeChild(wrap);
            }
            instances.splice(i, 1);
        }
    }

    function syncWithViewport() {
        var selects = document.querySelectorAll('select[data-mobile-select]');
        if (isMobile()) {
            Array.prototype.forEach.call(selects, function (select) {
                enhance(select);
            });
        } else {
            Array.prototype.forEach.call(selects, function (select) {
                teardown(select);
            });
        }
    }

    // Pages render some selects after DOMContentLoaded (shell includes),
    // so watch for late-added selects and enhance them without a refresh.
    var domObserver = null;
    function watchLateSelects() {
        if (domObserver) return;
        try {
            domObserver = new MutationObserver(function (mutations) {
                var found = false;
                for (var i = 0; i < mutations.length && !found; i += 1) {
                    var added = mutations[i].addedNodes || [];
                    for (var j = 0; j < added.length && !found; j += 1) {
                        var node = added[j];
                        if (!node || node.nodeType !== 1) continue;
                        if (node.matches && node.matches('select[data-mobile-select]')) found = true;
                        else if (node.querySelector && node.querySelector('select[data-mobile-select]')) found = true;
                    }
                }
                if (found && isMobile()) syncWithViewport();
            });
            if (document.body) domObserver.observe(document.body, { childList: true, subtree: true });
            else document.addEventListener('DOMContentLoaded', watchLateSelects);
        } catch (_) {
            domObserver = null;
        }
    }

    function init() {
        syncWithViewport();
        watchLateSelects();
        try {
            var mq = global.matchMedia(MOBILE_QUERY);
            if (mq) {
                if (typeof mq.addEventListener === 'function') {
                    mq.addEventListener('change', syncWithViewport);
                } else if (typeof mq.addListener === 'function') {
                    mq.addListener(syncWithViewport);
                }
            }
        } catch (_) {}
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    global.DiariMobileSelect = {
        enhance: enhance,
        teardown: teardown,
        sync: syncWithViewport,
    };
})(typeof window !== 'undefined' ? window : globalThis);
