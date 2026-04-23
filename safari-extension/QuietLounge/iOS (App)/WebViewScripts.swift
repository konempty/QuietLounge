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

          // QuietLounge 브랜드 컬러 — 다크 모드에선 어두운 배경 위 시인성을 위해 한 톤 밝게 사용.
          var QL_PRIMARY = (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)
            ? '#6A86F8' : '#4A6CF7';

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

          // ── 프로필 통계 ──
          var profileStatsCache = { personaId: null, stats: null, monthlyPosts: null, monthlyComments: null };
          var profileStatsRafId = null;
          var profileStatsObserver2 = null;

          function isProfilePage() { return window.location.pathname.startsWith('/profiles/'); }
          function getProfilePersonaId() {
            var m = window.location.pathname.match(/^\\/profiles\\/([^/?]+)/);
            return m ? m[1] : null;
          }

          function buildProfileStatsHtml() {
            var stats = profileStatsCache.stats;
            var totalPosts = stats.totalPostCount || 0;
            var totalComments = stats.totalCommentCount || 0;
            var mp = profileStatsCache.monthlyPosts;
            var mc = profileStatsCache.monthlyComments;
            var spinner = '<span style="display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,0.2);border-top-color:' + QL_PRIMARY + ';border-radius:50%;animation:ql-spin 0.8s linear infinite;vertical-align:middle;"></span>';
            var mpt = mp !== null ? mp : spinner;
            var mct = mc !== null ? mc : spinner;
            return '<div style="font-weight:600;font-size:14px;margin-bottom:10px;color:' + QL_PRIMARY + ';">활동 통계</div>' +
              '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">' +
              '<div style="text-align:center;padding:8px;background:rgba(0,0,0,0.1);border-radius:8px;"><div style="font-size:20px;font-weight:700;">' + totalPosts + '</div><div style="font-size:11px;opacity:0.7;margin-top:2px;">총 작성글</div></div>' +
              '<div style="text-align:center;padding:8px;background:rgba(0,0,0,0.1);border-radius:8px;"><div style="font-size:20px;font-weight:700;">' + totalComments + '</div><div style="font-size:11px;opacity:0.7;margin-top:2px;">총 댓글</div></div>' +
              '<div style="text-align:center;padding:8px;background:rgba(0,0,0,0.1);border-radius:8px;"><div style="font-size:20px;font-weight:700;">' + mpt + '</div><div style="font-size:11px;opacity:0.7;margin-top:2px;">이번달 작성글</div></div>' +
              '<div style="text-align:center;padding:8px;background:rgba(0,0,0,0.1);border-radius:8px;"><div style="font-size:20px;font-weight:700;">' + mct + '</div><div style="font-size:11px;opacity:0.7;margin-top:2px;">이번달 댓글</div></div></div>';
          }

          function insertProfileStatsBox() {
            if (document.getElementById('ql-profile-stats')) return;
            var tabsEl = document.querySelector('[data-slot="tabs"]');
            if (!tabsEl) return;
            var box = document.createElement('div');
            box.id = 'ql-profile-stats';
            box.style.cssText = 'margin:12px 20px 0;padding:14px 16px;background:rgba(74,108,247,0.08);border:1px solid rgba(74,108,247,0.2);border-radius:10px;font-size:13px;color:var(--color-neutral-foreground-default,#e0e0e0);';
            box.innerHTML = buildProfileStatsHtml();
            tabsEl.before(box);
          }

          if (!document.getElementById('ql-spinner-style')) {
            var spStyle = document.createElement('style');
            spStyle.id = 'ql-spinner-style';
            spStyle.textContent = '@keyframes ql-spin { to { transform: rotate(360deg); } }';
            document.head.appendChild(spStyle);
          }

          function profileDebounce(fn, d) { var t; return function() { clearTimeout(t); t = setTimeout(fn, d); }; }

          function stopProfileStatsGuard() {
            if (profileStatsRafId) { cancelAnimationFrame(profileStatsRafId); profileStatsRafId = null; }
            if (profileStatsObserver2) { profileStatsObserver2.disconnect(); profileStatsObserver2 = null; }
          }

          function startProfileStatsGuard() {
            stopProfileStatsGuard();
            var startTime = Date.now();
            function tick() {
              if (!isProfilePage() || !profileStatsCache.stats) { profileStatsRafId = null; return; }
              insertProfileStatsBox();
              if (Date.now() - startTime < 3000) { profileStatsRafId = requestAnimationFrame(tick); }
              else {
                profileStatsRafId = null;
                profileStatsObserver2 = new MutationObserver(profileDebounce(function() {
                  if (isProfilePage() && profileStatsCache.stats) insertProfileStatsBox();
                }, 100));
                profileStatsObserver2.observe(document.body, { childList: true, subtree: true });
              }
            }
            profileStatsRafId = requestAnimationFrame(tick);
          }

          function fetchMonthlyCount(personaId, type, monthStart) {
            var count = 0; var cursor = ''; var isComments = type === 'comments';
            function fetchPage(page) {
              if (page >= 50) return Promise.resolve(count);
              var actUrl = 'https://api.lounge.naver.com/user-api/v1/personas/' + personaId + '/activities/' + type + '?limit=100' + (cursor ? '&cursor=' + cursor : '');
              return fetch(actUrl, { credentials: 'include' }).then(function(r) {
                if (!r.ok) return count;
                return r.json().then(function(j) {
                  var items = j.data && j.data.items ? j.data.items : [];
                  if (items.length === 0) return count;
                  var ids, params, detailUrl;
                  if (isComments) {
                    ids = items.map(function(it) { return it.commentId; });
                    params = ids.map(function(id) { return 'commentNoList=' + id; }).join('&');
                    detailUrl = 'https://api.lounge.naver.com/content-api/v1/comments?' + params;
                  } else {
                    ids = items.map(function(it) { return it.postId; });
                    params = ids.map(function(id) { return 'postIds=' + id; }).join('&');
                    detailUrl = 'https://api.lounge.naver.com/content-api/v1/posts?' + params;
                  }
                  return fetch(detailUrl, { credentials: 'include' }).then(function(dr) {
                    if (!dr.ok) return count;
                    return dr.json().then(function(dj) {
                      var hasThisMonth = false;
                      if (isComments) {
                        var raw = dj.data && dj.data.rawResponse ? dj.data.rawResponse : null;
                        var parsed = raw ? JSON.parse(raw) : null;
                        var cl = parsed && parsed.result ? parsed.result.commentList || [] : [];
                        for (var i = 0; i < cl.length; i++) {
                          var rd = cl[i].regTimeGmt || '';
                          if (rd && new Date(rd) >= monthStart) { count++; hasThisMonth = true; }
                        }
                      } else {
                        var details = Array.isArray(dj.data) ? dj.data : [];
                        for (var k = 0; k < details.length; k++) {
                          var ds = details[k].createTime || '';
                          if (ds && new Date(ds) >= monthStart) { count++; hasThisMonth = true; }
                        }
                      }
                      if (!hasThisMonth) return count;
                      if (!j.data.cursorInfo || !j.data.cursorInfo.hasNext) return count;
                      cursor = j.data.cursorInfo.endCursor || '';
                      if (!cursor) return count;
                      return fetchPage(page + 1);
                    });
                  });
                });
              }).catch(function() { return count; });
            }
            return fetchPage(0);
          }

          function injectProfileStats() {
            if (!isProfilePage()) return;
            var personaId = getProfilePersonaId();
            if (!personaId) return;
            if (profileStatsCache.personaId === personaId && profileStatsCache.stats) {
              startProfileStatsGuard();
              return;
            }
            fetch('https://api.lounge.naver.com/user-api/v1/personas/' + personaId, { credentials: 'include' })
              .then(function(r) { return r.ok ? r.json() : null; })
              .then(function(j) {
                if (!j || !j.data) return;
                var stats = j.data;
                profileStatsCache = { personaId: personaId, stats: stats, monthlyPosts: null, monthlyComments: null };
                var now = new Date();
                var monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
                var createTime = stats.createTime ? new Date(stats.createTime) : null;
                var createdThisMonth = createTime && createTime >= monthStart;
                if (createdThisMonth) {
                  profileStatsCache.monthlyPosts = stats.totalPostCount || 0;
                  profileStatsCache.monthlyComments = stats.totalCommentCount || 0;
                } else {
                  fetchMonthlyCount(personaId, 'posts', monthStart).then(function(c) {
                    profileStatsCache.monthlyPosts = c;
                    var el = document.getElementById('ql-profile-stats');
                    if (el) el.innerHTML = buildProfileStatsHtml();
                  });
                  fetchMonthlyCount(personaId, 'comments', monthStart).then(function(c) {
                    profileStatsCache.monthlyComments = c;
                    var el = document.getElementById('ql-profile-stats');
                    if (el) el.innerHTML = buildProfileStatsHtml();
                  });
                }
                startProfileStatsGuard();
              });
          }

          var lastPath = window.location.pathname;
          function onNavigate() {
            var newPath = window.location.pathname;
            if (newPath === lastPath) return;
            lastPath = newPath;
            profileStatsCache = { personaId: null, stats: null, monthlyPosts: null, monthlyComments: null };
            stopProfileStatsGuard();
            if (isActivePage()) { setTimeout(function() { filterAll(); injectButtons(); }, 500); }
            if (isProfilePage()) { setTimeout(injectProfileStats, 500); }
          }
          window.addEventListener('popstate', onNavigate);
          var origPush = history.pushState;
          history.pushState = function() { origPush.apply(this, arguments); onNavigate(); };
          var origReplace = history.replaceState;
          history.replaceState = function() { origReplace.apply(this, arguments); onNavigate(); };

          if (isProfilePage()) injectProfileStats();
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
