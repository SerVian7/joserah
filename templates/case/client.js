/* Case research view. Runs in the page and in tools/case.js (initial markup), so both agree. */
function caseView(D, L, g, k) {
  var esc = function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
  var url = function (u) { return /^https?:\/\//i.test(String(u || '')) ? esc(u) : ''; };
  var link = function (l) { var u = url(l.url); return u ? '<a href="' + u + '" target="_blank" rel="noopener">' + esc(l.label || L.link) + '</a>' : ''; };
  var dotc = function (s) { return /^(ok|wait|no)$/.test(s) ? s : ''; };
  var card = function (c, gname) {
    var st = dotc(c.status);
    var specs = (c.specs || []).map(function (s) { return '<dt>' + esc(s[0]) + '</dt><dd>' + esc(s[1]) + '</dd>'; }).join('');
    var links = (c.links || []).map(link).join('');
    var img = c.image && !/^[a-z]+:|^\/|\.\./i.test(c.image) ? '<img src="' + esc(c.image) + '" alt="' + esc(c.title) + '">' : '';
    return '<article class="case" aria-live="polite"><div class="img">' + img + '</div><div class="body">' +
      '<div class="lbl">' + esc(gname) + '</div>' + (c.picked ? '<span class="pick">' + esc(L.picked) + '</span>' : '') +
      '<h2>' + esc(c.title) + '</h2>' + (c.sub ? '<p class="sub">' + esc(c.sub) + '</p>' : '') +
      (st && c.why ? '<p class="why ' + st + 't"><i class="dot ' + st + '" title="' + esc(L[st]) + '"></i>' + esc(c.why) + '</p>' : '') +
      (c.rec ? '<div class="rec"><b>' + esc(L.rec) + '</b>' + esc(c.rec) + '</div>' : '') +
      (c.price ? '<div class="price">' + esc(c.price) + (c.priceNote ? '<small>' + esc(c.priceNote) + '</small>' : '') + '</div>' : '') +
      ((c.pro || []).length || (c.con || []).length ? '<div class="pc">' + (c.pro || []).map(function (p) { return '<p class="p">' + esc(p) + '</p>'; }).join('') + (c.con || []).map(function (p) { return '<p class="c">' + esc(p) + '</p>'; }).join('') + '</div>' : '') +
      (specs ? '<details class="more"><summary>' + esc(L.details) + '</summary><dl class="kv">' + specs + '</dl></details>' : '') +
      (links ? '<div class="links">' + links + '</div>' : '') + '</div></article>';
  };
  var groups = D.groups.map(function (G, gi) {
    var open = gi === g, n = G.cases.length;
    var h = '<button type="button" class="grp gbtn" data-g="' + gi + '" aria-expanded="' + open + '"><span class="car">' + (open ? '▾' : '▸') + '</span>' + esc(G.name) + ' <span class="cnt">' + n + '</span></button>';
    if (!open) return '<div class="g">' + h + '</div>';
    return '<div class="g">' + h + (G.note ? '<p class="gnote">' + esc(G.note) + '</p>' : '') +
      '<div class="chips">' + G.cases.map(function (c, i) { return '<button type="button" data-i="' + i + '" aria-current="' + (i === k) + '"><i class="dot ' + dotc(c.status) + '"></i>' + esc(c.title) + '</button>'; }).join('') + '</div>' +
      (n ? card(G.cases[k], G.name) + '<div class="navb"><button id="prev" type="button"' + (k === 0 ? ' disabled' : '') + '>← ' + esc(L.prev) + '</button><span>' + (k + 1) + ' / ' + n + '</span><button id="next" type="button"' + (k === n - 1 ? ' disabled' : '') + '>' + esc(L.next) + ' →</button></div>' : '') + '</div>';
  }).join('');
  var U = D.update || {};
  var items = (U.items || []).map(function (it) {
    return '<li><i class="dot ' + dotc(it.state) + '"></i><span>' + esc(it.text) + '</span><em>' + esc(it.date || '') + '</em></li>';
  }).join('');
  var ul = (U.links || []).map(link).filter(Boolean).join(' · ');
  var upd = '<section class="req"><div class="grp">' + esc(L.update) + (U.date ? ' · ' + esc(U.date) : '') + '</div>' +
    (D.job ? '<p class="job">' + esc(D.job) + '</p>' : '') +
    (items ? '<ul>' + items + '</ul>' : '') + (ul ? '<p class="ulinks">' + ul + '</p>' : '') + '</section>';
  return { list: groups, update: upd };
}
if (typeof document !== 'undefined') {
  (function () {
    var D = JSON.parse(document.getElementById('data').textContent), L = D.labels, g = 0, k = 0;
    function draw() {
      document.getElementById('list').innerHTML = caseView(D, L, g, k).list;
      document.querySelectorAll('.gbtn').forEach(function (b) { b.onclick = function () { var i = +b.dataset.g; g = g === i ? -1 : i; k = 0; draw(); }; });
      document.querySelectorAll('.chips button').forEach(function (b) { b.onclick = function () { k = +b.dataset.i; draw(); }; });
      var p = document.getElementById('prev'), n = document.getElementById('next');
      if (p) p.onclick = function () { if (k > 0) { k--; draw(); } };
      if (n) n.onclick = function () { if (k < D.groups[g].cases.length - 1) { k++; draw(); } };
    }
    document.addEventListener('keydown', function (e) {
      if (g < 0) return;
      if (e.key === 'ArrowLeft' && k > 0) { k--; draw(); }
      if (e.key === 'ArrowRight' && k < D.groups[g].cases.length - 1) { k++; draw(); }
    });
    draw();
  })();
}
if (typeof module !== 'undefined') module.exports = caseView;
