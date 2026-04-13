import Foundation

enum WebViewScripts {

    /// fetch monkey-patch — 페이지 로드 전 주입
    static let beforeScript: String = """
    (function() {
      'use strict';
      if (window.__QL_BEFORE_INSTALLED) return;
      window.__QL_BEFORE_INSTALLED = true;

      window.__QL = { personaMap: {}, personaCache: {} };

      var origFetch = window.fetch;
      window.fetch = async function() {
        var resp = await origFetch.apply(this, arguments);
        var url = typeof arguments[0] === 'string' ? arguments[0] : (arguments[0] && arguments[0].url || '');
        try {
          if (url.indexOf('api.lounge.naver.com') !== -1) {
            var data = await resp.clone().json();
            extractMappings(data);
            if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.qlBridge) {
              window.webkit.messageHandlers.qlBridge.postMessage(JSON.stringify({
                type: 'PERSONA_MAP_UPDATE',
                payload: { personaMap: window.__QL.personaMap, personaCache: window.__QL.personaCache }
              }));
            }
          }
        } catch(e) {}
        return resp;
      };

      function extractMappings(obj) {
        if (!obj || typeof obj !== 'object') return;
        if (Array.isArray(obj)) { obj.forEach(extractMappings); return; }
        if (typeof obj.postId === 'string' && typeof obj.personaId === 'string')
          window.__QL.personaMap[obj.postId] = obj.personaId;
        if (typeof obj.personaId === 'string' && typeof obj.nickname === 'string')
          window.__QL.personaCache[obj.personaId] = obj.nickname;
        Object.values(obj).forEach(extractMappings);
      }

      document.addEventListener('DOMContentLoaded', function() {
        document.querySelectorAll('script').forEach(function(s) {
          var t = s.textContent;
          if (!t) return;
          var regex1 = /\\\\"postId\\\\":\\\\"([^"\\\\]+)\\\\",\\\\"personaId\\\\":\\\\"([^"\\\\]+)\\\\"/g;
          var m;
          while ((m = regex1.exec(t)) !== null) { window.__QL.personaMap[m[1]] = m[2]; }
          var regex4 = /\\\\"personaId\\\\":\\\\"([^"\\\\]+)\\\\",\\\\"nickname\\\\":\\\\"([^"\\\\]+)\\\\"/g;
          while ((m = regex4.exec(t)) !== null) { window.__QL.personaCache[m[1]] = m[2]; }
        });
        document.querySelectorAll('a[href^="/profiles/"]').forEach(function(link) {
          var pid = link.getAttribute('href').replace('/profiles/', '');
          var nick = link.textContent.trim();
          if (pid && nick && pid.length >= 6) window.__QL.personaCache[pid] = nick;
        });
        if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.qlBridge) {
          window.webkit.messageHandlers.qlBridge.postMessage(JSON.stringify({
            type: 'PERSONA_MAP_UPDATE',
            payload: { personaMap: window.__QL.personaMap, personaCache: window.__QL.personaCache }
          }));
        }
      });
    })();
    true;
    """

    /// 필터링 + 차단 버튼 + 프로필 통계 — 페이지 로드 후 주입
    static func afterScript(blockData: [String: Any], filterMode: String) -> String {
        let blockDataJSON = (try? JSONSerialization.data(withJSONObject: blockData))
            .flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
        return """
        (function() {
          'use strict';
          if (window.__QL_AFTER_INSTALLED) {
            window.__QL_BLOCK_DATA = \(blockDataJSON);
            window.__QL_FILTER_MODE = '\(filterMode)';
            if (window.__QL_onBlockListUpdate) window.__QL_onBlockListUpdate();
            return;
          }
          window.__QL_AFTER_INSTALLED = true;
          window.__QL_BLOCK_DATA = \(blockDataJSON);
          window.__QL_FILTER_MODE = '\(filterMode)';

          var SEL = {
            scrollContainer: '.infinite-scroll-component',
            postLink: 'a[href^="/posts/"]',
            postContainer: '.relative[tabindex]',
            nickname: '[data-slot="profile-name-label"] span.truncate',
            profileName: '[data-slot="profile-name"]',
            separator: '[data-slot="separator"]',
            card: '[data-slot="card"]',
            cardItem: '[data-slot="carousel-item"]',
          };

          function isActivePage() { var p = window.location.pathname; return p === '/' || p.startsWith('/posts') || p.startsWith('/channels'); }
          function isBlockButtonPage() { var p = window.location.pathname; return p.startsWith('/posts') || p.startsWith('/channels'); }

          function isBlocked(personaId, nickname) {
            var d = window.__QL_BLOCK_DATA; if (!d) return false;
            if (personaId && d.blockedUsers && d.blockedUsers[personaId]) return true;
            if (nickname) {
              var users = d.blockedUsers || {};
              for (var key in users) { if (users[key].nickname === nickname) return true; }
              var nbs = d.nicknameOnlyBlocks || [];
              for (var i = 0; i < nbs.length; i++) { if (nbs[i].nickname === nickname) return true; }
            }
            return false;
          }

          function applyStyle(el, blocked) {
            if (!el) return;
            var mode = window.__QL_FILTER_MODE || 'hide';
            if (blocked) {
              if (mode === 'blur') { el.style.filter='blur(5px)'; el.style.opacity='0.3'; el.style.pointerEvents='none'; el.style.display=''; }
              else { el.style.display='none'; el.style.filter=''; el.style.opacity=''; el.style.pointerEvents=''; }
            } else { el.style.display=''; el.style.filter=''; el.style.opacity=''; el.style.pointerEvents=''; }
          }

          function filterAll() {
            if (!isActivePage()) return;
            var ql = window.__QL || { personaMap: {} };
            document.querySelectorAll(SEL.postLink).forEach(function(link) {
              var postId = link.getAttribute('href').replace('/posts/','');
              var nickname = (link.querySelector(SEL.nickname)||{}).textContent;
              if (nickname) nickname = nickname.trim();
              var pid = postId ? ql.personaMap[postId] : undefined;
              var container = link.closest(SEL.postContainer) || (link.parentElement && link.parentElement.parentElement);
              if (!container) return;
              var blocked = isBlocked(pid, nickname);
              applyStyle(container, blocked);
              var sep = container.parentElement && container.parentElement.nextElementSibling;
              if (sep && sep.getAttribute && sep.getAttribute('data-slot') === 'separator') applyStyle(sep, blocked);
            });
          }

          function sendBlockMessage(pid, nickname) {
            if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.qlBridge) {
              window.webkit.messageHandlers.qlBridge.postMessage(JSON.stringify({
                type: 'BLOCK_USER', payload: { personaId: pid || null, nickname: nickname }
              }));
            }
          }

          function injectButtons() {
            if (!isBlockButtonPage()) return;
            document.querySelectorAll(SEL.profileName).forEach(function(el) {
              if (el.querySelector('.ql-btn')) return;
              var btn = document.createElement('button');
              btn.className = 'ql-btn';
              btn.textContent = '\\u2715';
              btn.style.cssText = 'margin-left:6px;cursor:pointer;opacity:0.5;font-size:16px;border:none;background:rgba(200,50,50,0.12);padding:4px 8px;color:#e74c3c;border-radius:4px;transition:opacity 0.15s;line-height:1;min-width:28px;min-height:28px;display:inline-flex;align-items:center;justify-content:center;';
              btn.ontouchstart = function() { btn.style.opacity='1'; };
              btn.ontouchend = function() { btn.style.opacity='0.5'; };
              btn.onclick = function(e) {
                e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
                var nickname = (el.querySelector('[data-slot="profile-name-label"] span.truncate')||{}).textContent;
                if (!nickname) return; nickname = nickname.trim();
                var pid, ql = window.__QL || { personaMap: {} };
                var profileLink = el.querySelector('a[href^="/profiles/"]');
                if (profileLink) pid = profileLink.getAttribute('href').replace('/profiles/','');
                if (!pid) {
                  var postLink = el.closest('a[href^="/posts/"]') || (el.closest(SEL.postContainer)||{}).querySelector && el.closest(SEL.postContainer).querySelector('a[href^="/posts/"]');
                  if (postLink) { var postId = postLink.getAttribute('href').replace('/posts/',''); if (postId) pid = ql.personaMap[postId]; }
                }
                if (!pid) { var pm = window.location.pathname.match(/^\\/posts\\/([^/]+)/); if (pm) pid = ql.personaMap[pm[1]]; }
                sendBlockMessage(pid, nickname);
              };
              el.appendChild(btn);
            });
          }

          window.__QL_onBlockListUpdate = function() { filterAll(); injectButtons(); };
          window.__QL_setFilterMode = function(mode) { window.__QL_FILTER_MODE = mode; filterAll(); };

          if (isActivePage()) { filterAll(); injectButtons(); }

          var timer;
          var debounced = function() { clearTimeout(timer); timer = setTimeout(function() { if (isActivePage()) { filterAll(); injectButtons(); } }, 200); };
          var target = document.querySelector(SEL.scrollContainer) || document.body;
          new MutationObserver(debounced).observe(target, { childList: true, subtree: true });

          var lastPath = window.location.pathname;
          function onNavigate() {
            var newPath = window.location.pathname;
            if (newPath === lastPath) return;
            lastPath = newPath;
            if (isActivePage()) { setTimeout(function() { filterAll(); injectButtons(); }, 500); }
          }
          window.addEventListener('popstate', onNavigate);
          var origPush = history.pushState;
          history.pushState = function() { origPush.apply(this, arguments); onNavigate(); };
          var origReplace = history.replaceState;
          history.replaceState = function() { origReplace.apply(this, arguments); onNavigate(); };
        })();
        true;
        """
    }

    /// 차단 목록 업데이트 push
    static func blockListUpdateScript(blockData: [String: Any]) -> String {
        let json = (try? JSONSerialization.data(withJSONObject: blockData))
            .flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
        return "window.__QL_BLOCK_DATA = \(json); if(window.__QL_onBlockListUpdate) window.__QL_onBlockListUpdate(); true;"
    }
}
