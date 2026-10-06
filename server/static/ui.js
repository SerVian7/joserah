/* Joserah platform interface: the living layer. No library: native CSS, the Web Animations API and one small WebGL
   shader. Everything here is an enhancement; with it gone the pages still work. */
(function () {
  'use strict';
  var D = document, H = D.documentElement, W = window;
  var V = ((D.currentScript && D.currentScript.src) || '').split('v=')[1] || '0';
  var REDUCED = W.matchMedia && W.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var $ = function (s, r) { return (r || D).querySelector(s); };
  var top = $('header.top');
  var WORDS = {}; try { WORDS = JSON.parse((top && top.getAttribute('data-words')) || '{}'); } catch (e) { /* none */ }
  var say = function (k, n) { var s = WORDS[k] || ''; return n === undefined ? s : s.replace('{n}', String(n)); };
  var calm = false; try { calm = localStorage.getItem('jz-calm') === '1'; } catch (e) { /* private mode */ }
  if (calm) H.classList.add('calm');

  /* 1. The J. The recorded mark is the brand's faded J (burgundy at a few per cent); the page lifts its shape to full
     strength once, keeps it for later visits, and paints it with the brand colour through a CSS mask. */
  function liftMark() {
    return new Promise(function (resolve) {
      if (H.classList.contains('jm')) return resolve();
      var img = new Image();
      img.onload = function () {
        try {
          var S = 768, c = D.createElement('canvas'); c.width = c.height = S;
          var x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(img, 0, 0, S, S);
          var d = x.getImageData(0, 0, S, S), p = d.data;
          for (var i = 0; i < p.length; i += 4) {
            var a = p[i + 3] / 18; a = a <= 0.12 ? 0 : a >= 0.88 ? 1 : (a - 0.12) / 0.76; a = a * a * (3 - 2 * a);
            p[i] = 0; p[i + 1] = 0; p[i + 2] = 0; p[i + 3] = Math.round(a * 255);
          }
          x.putImageData(d, 0, 0);
          var url = c.toDataURL('image/png');
          H.style.setProperty('--jm', 'url(' + url + ')'); H.classList.add('jm');
          try { localStorage.setItem('jz-mask-' + V, url); } catch (e) { /* full or private: lift again next time */ }
        } catch (e) { /* the faded J stays; nothing breaks */ }
        resolve();
      };
      img.onerror = function () { resolve(); };
      img.src = '/_/s/j.png';
    });
  }

  /* 2. Live state. One event stream per page (the page script's, when it opened one), and /api/presence for the facts. */
  var signedIn = !!top;
  var es = W.jzES || null;
  if (!es && signedIn && W.EventSource) { es = new EventSource('/events'); W.jzES = es; }
  var connected = new Promise(function (resolve) {
    if (!es) return resolve();
    if (es.readyState === 1) return resolve();
    es.addEventListener('open', function () { resolve(); });
    setTimeout(resolve, 2600);
  });
  var field = null, last = { waiting: -1 };
  var isHome = !!$('#presence');
  if (isHome) W.jzLive = true;

  function setNet(on) { if (on) H.removeAttribute('data-net'); else H.setAttribute('data-net', 'off'); if (field) field.off = on ? 0 : 1; if (!on) setLive(say('offline')); }
  if (es) {
    es.addEventListener('open', function () { setNet(true); refresh(); });
    es.addEventListener('error', function () { if (es.readyState !== 1) setNet(false); });
    es.addEventListener('message', function (m) {
      var e; try { e = JSON.parse(m.data); } catch (x) { return; }
      if (e.type === 'job') {
        var ev = e.event || {};
        if (ev.kind === 'text' || ev.kind === 'tool') { spark(0.7); setLive(ev.kind === 'tool' ? ev.name : ev.text); }
        if (ev.kind === 'state' || ev.kind === 'result') { spark(1); soon(); if (ev.kind === 'result') setLive(''); }
      } else if (e.type === 'jobs' || e.type === 'changed' || e.type === 'answers') soon();
    });
  }
  var timer = 0;
  function soon() { clearTimeout(timer); timer = setTimeout(refresh, 350); }
  function spark(v) { if (field) field.spark = Math.max(field.spark, v); }

  function refresh() {
    if (!signedIn) return;
    fetch('/api/presence', { credentials: 'same-origin', headers: { accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (p) { if (p) render(p); }, function () { /* offline: the stream says so */ });
  }

  function el(tag, cls, text) { var n = D.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; }
  function render(p) {
    H.setAttribute('data-state', p.mode);
    var nw = p.waiting.length, nr = p.running.length;
    var pulse = $('.pulse');
    if (pulse) {
      var t = nw ? say(nw === 1 ? 'waiting1' : 'waitingN', nw) : nr ? say(nr === 1 ? 'working1' : 'workingN', nr) : '';
      pulse.hidden = !t; $('span', pulse).textContent = t;
      pulse.setAttribute('href', nw ? '/p/tracker' : nr ? '/jobs' : '/');
    }
    if (field) { field.energyT = nr ? 1 : 0.12; field.waitT = nw ? 1 : 0; }
    if (last.waiting >= 0 && nw > last.waiting) spark(1);
    last.waiting = nw;
    if (!isHome) return;
    var now = $('#say-now'); now.textContent = '';
    var lines = []; if (nw) lines.push(say(nw === 1 ? 'waiting1' : 'waitingN', nw)); if (nr) lines.push(say(nr === 1 ? 'working1' : 'workingN', nr)); if (!lines.length) lines.push(say('here'));
    lines.forEach(function (s) { now.appendChild(el('span', '', s)); now.appendChild(D.createTextNode(' ')); });
    var ul = $('#waiting'); ul.textContent = '';
    p.waiting.slice(0, 4).forEach(function (w) { var li = el('li'), a = el('a', '', w.title); a.href = w.url; li.appendChild(a); if (w.small) li.appendChild(el('span', '', w.small)); ul.appendChild(li); });
    if (nw > 4) { var li = el('li', 'more-n'), a = el('a', '', say('more', nw - 4)); a.href = '/p/tracker'; li.appendChild(a); ul.appendChild(li); }
    var run = $('#running');
    if (run) {
      run.textContent = '';
      if (!nr) run.appendChild(el('li', 'muted empty', say('none')));
      p.running.forEach(function (j) {
        var li = el('li'); li.setAttribute('data-job', j.id); li.setAttribute('data-state', j.state);
        var a = el('a', '', j.title); a.href = '/jobs/' + encodeURIComponent(j.id);
        li.appendChild(a); li.appendChild(D.createTextNode(' ')); li.appendChild(el('span', 'state', j.state)); li.appendChild(el('span', 'last muted'));
        run.appendChild(li);
      });
    }
    if (!nr && H.getAttribute('data-net') !== 'off') setLive('');
  }

  var liveEl = $('#say-live');
  function setLive(text) {
    if (!liveEl) return;
    var t = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 160);
    if (liveEl.textContent === t) return;
    liveEl.textContent = t;
    if (t && !REDUCED && liveEl.animate) liveEl.animate([{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: 'cubic-bezier(.2,.7,.2,1)' });
  }

  /* 3. The field: a slow burgundy light around the J. Calm when idle, flowing outward while a job runs, a rose ring
     every few seconds while something waits on the owner, a flash when an event arrives. One shader, no library. */
  var FS = [
    '#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif',
    'uniform vec3 J;uniform float T,E,Wt,S,O,Dk;uniform vec2 P;uniform vec3 C1,C2;uniform sampler2D M;',
    'float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}',
    'float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1.,0.)),f.x),mix(h(i+vec2(0.,1.)),h(i+vec2(1.,1.)),f.x),f.y);}',
    'float fb(vec2 p){float v=0.,a=.5;for(int i=0;i<4;i++){v+=a*n(p);p=p*2.02+11.3;a*=.5;}return v;}',
    'float m(vec2 uv,float b){return clamp(texture2D(M,uv,b).a*14.,0.,1.);}',
    'void main(){vec2 q=(gl_FragCoord.xy-J.xy)/J.z;vec2 uv=.5+q*.5;float d=length(q);',
    'float halo=m(uv,2.5)*.3+m(uv,4.)*.4+m(uv,5.5)*.45;vec2 dir=q/(d+.001);float fl=T*(.025+.17*E);',
    'vec2 w=q*1.6+P*.12;vec2 wp=vec2(fb(w+vec2(0.,fl)),fb(w+vec2(4.7,-fl)));float f=fb(w*1.25+wp*1.6-dir*fl*2.);',
    'float fall=exp(-d*d*.85);float body=smoothstep(.42,.95,f)*fall;',
    // Echoes of the J itself, not circles: the mark's own outline swells outward and fades.
    'float pw=fract(T/3.4);float ew=Wt*m(.5+q*.5/(1.+pw*.8),1.5+pw*3.)*(1.-pw)*(1.-pw);',
    'float pr=fract(T/1.5);float er=E*m(.5+q*.5/(1.+pr*.55),1.+pr*2.5)*(1.-pr)*(1.-pr)*.55;',
    'float a=body*(.24+.3*E)+halo*(.28+.3*E+.6*S)+ew*.75+er+S*.3*exp(-d*3.);',
    'a*=(1.-.75*O)*mix(.55,1.,Dk);a=clamp(a+(h(gl_FragCoord.xy+fract(T))-.5)/255.,0.,1.);',
    'vec3 c=mix(C1,C2,clamp(f*.6+E*.15+ew*1.4+halo*.25,0.,1.));gl_FragColor=vec4(c*a,a);}'
  ].join('\n');
  var VS = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';

  function rgb(hex) { var m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim()); var v = m ? parseInt(m[1], 16) : 0x8b0d32; return [(v >> 16 & 255) / 255, (v >> 8 & 255) / 255, (v & 255) / 255]; }

  function makeField(cv, jEl) {
    var gl = cv.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, powerPreference: 'low-power' });
    if (!gl) return null;
    function sh(type, src) { var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null; }
    var vs = sh(gl.VERTEX_SHADER, VS), fs = sh(gl.FRAGMENT_SHADER, FS);
    if (!vs || !fs) return null;
    var pr = gl.createProgram(); gl.attachShader(pr, vs); gl.attachShader(pr, fs); gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) return null;
    gl.useProgram(pr);
    var b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(pr, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    var U = {}; ['J', 'T', 'E', 'Wt', 'S', 'O', 'Dk', 'P', 'C1', 'C2', 'M'].forEach(function (k) { U[k] = gl.getUniformLocation(pr, k); });
    var tex = gl.createTexture(), ready = false;
    var img = new Image(); img.onload = function () {
      var c = D.createElement('canvas'); c.width = c.height = 512; c.getContext('2d').drawImage(img, 128, 128, 256, 256);
      gl.bindTexture(gl.TEXTURE_2D, tex); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.generateMipmap(gl.TEXTURE_2D);
      ready = true; draw(performance.now());
    };
    img.src = '/_/s/j.png';
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    var F = { energy: 0.12, energyT: 0.12, wait: 0, waitT: 0, spark: 0, off: 0, px: 0, py: 0, tx: 0, ty: 0, running: false };
    var dpr = Math.min(W.devicePixelRatio || 1, W.innerWidth < 700 ? 1.25 : 1.5);
    var t0 = performance.now(), lastF = 0, raf = 0, visible = true;
    function size() { var w = Math.round(cv.clientWidth * dpr), h = Math.round(cv.clientHeight * dpr); if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; gl.viewport(0, 0, w, h); } }
    function colours() {
      var cs = getComputedStyle(H), dark = rgb(cs.getPropertyValue('--bg'))[0] < 0.4;
      gl.uniform3fv(U.C1, rgb(cs.getPropertyValue('--brand'))); gl.uniform3fv(U.C2, rgb(cs.getPropertyValue('--rose'))); gl.uniform1f(U.Dk, dark ? 1 : 0);
    }
    function draw(now) {
      if (!ready) return;
      size();
      var r = cv.getBoundingClientRect(), j = jEl.getBoundingClientRect();
      var k = 0.06;
      F.energy += (F.energyT - F.energy) * k * 0.5; F.wait += (F.waitT - F.wait) * k; F.spark *= 0.955; F.px += (F.tx - F.px) * 0.04; F.py += (F.ty - F.py) * 0.04;
      gl.uniform3f(U.J, (j.left + j.width / 2 - r.left) * dpr, (r.bottom - (j.top + j.height / 2)) * dpr, Math.max(j.width, 1) * dpr);
      gl.uniform1f(U.T, REDUCED ? 7 : ((now - t0) / 1000) % 3600);
      gl.uniform1f(U.E, F.energy); gl.uniform1f(U.Wt, F.wait); gl.uniform1f(U.S, F.spark); gl.uniform1f(U.O, F.off); gl.uniform2f(U.P, F.px, F.py);
      gl.uniform1i(U.M, 0);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    function loop(now) {
      raf = 0;
      if (!F.running) return;
      // Idle and nothing waiting: half the frames are plenty.
      var slow = F.energy < 0.3 && F.wait < 0.1 && F.spark < 0.05;
      if (!slow || now - lastF > 31) { draw(now); lastF = now; }
      raf = requestAnimationFrame(loop);
    }
    F.start = function () { if (REDUCED || calm || F.running || !visible || D.hidden) { draw(performance.now()); return; } F.running = true; raf = requestAnimationFrame(loop); };
    F.stop = function () { F.running = false; if (raf) cancelAnimationFrame(raf); raf = 0; };
    F.redraw = function () { draw(performance.now()); };
    colours();
    if (W.matchMedia) W.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () { colours(); F.redraw(); });
    D.addEventListener('visibilitychange', function () { if (D.hidden) F.stop(); else F.start(); });
    if (W.IntersectionObserver) new IntersectionObserver(function (es) { visible = es[0].isIntersecting; if (visible) F.start(); else F.stop(); }).observe(cv);
    var host = cv.parentNode;
    host.addEventListener('pointermove', function (e) { var r = host.getBoundingClientRect(); F.tx = (e.clientX - r.left) / r.width - 0.5; F.ty = 0.5 - (e.clientY - r.top) / r.height; });
    host.addEventListener('pointerleave', function () { F.tx = 0; F.ty = 0; });
    W.addEventListener('resize', function () { if (!F.running) F.redraw(); });
    return F;
  }

  /* 4. The load sequence, first page of a visit: the leaf of the J drops in, the stroke draws from it down and round,
     light runs through the mark, and when the live stream answers the J moves to where it lives on the page. */
  var SPRING = 'linear(0, .009, .035 2.1%, .141, .281 6.7%, .723 12.9%, .938 16.7%, 1.017, 1.077, 1.121, 1.149 24.3%, 1.159, 1.163, 1.161, 1.154 29.9%, 1.129 32.8%, 1.051 39.6%, 1.017 43.1%, .991, .977 51%, .974 53.8%, .975 57.1%, .997 69.8%, 1.003 76.9%, 1)';
  var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  function boot() {
    var box = $('#boot');
    if (!H.classList.contains('boot') || !box || !box.animate) { H.classList.remove('boot'); return Promise.resolve(); }
    try { sessionStorage.setItem('jz-seen', '1'); } catch (e) { /* fine */ }
    box.classList.add('on');
    var mark = $('.jmark', box);
    var jb = el('div', 'jbox');
    jb.innerHTML = '<span class="jmark ghost"></span><span class="jmark piece leaf"></span><span class="jmark piece bowl"></span><span class="jmark jfill" style="opacity:0"></span>';
    mark.replaceWith(jb);
    var t0 = performance.now();
    return liftMark().then(function () {
      jb.classList.add('go');
      $('.leaf', jb).animate([{ opacity: 0, transform: 'translateY(-26%)' }, { opacity: 1, transform: 'none' }], { duration: 900, delay: 120, easing: SPRING, fill: 'forwards' });
      return wait(1380);
    }).then(function () {
      $('.jfill', jb).style.opacity = '1';
      [].forEach.call(jb.querySelectorAll('.piece'), function (p) { p.style.visibility = 'hidden'; });
      jb.classList.add('lit');
      return Promise.all([connected, wait(Math.max(0, 1900 - (performance.now() - t0)))]);
    }).then(function () {
      var target = $('main .jmark.hero') || $('header.top .mark .jmark');
      var from = jb.getBoundingClientRect();
      H.classList.remove('boot');
      var to = target && target.getBoundingClientRect();
      var parts = [top, $('main')].filter(Boolean);
      parts.forEach(function (p, i) { p.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 520, delay: 160 + i * 90, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'backwards' }); });
      box.animate([{ backgroundColor: getComputedStyle(box).backgroundColor }, { backgroundColor: 'transparent' }], { duration: 520, easing: 'ease-out', fill: 'forwards' });
      if (!to || !to.width) return wait(1).then(function () { return jb.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 400, fill: 'forwards' }).finished; });
      target.style.visibility = 'hidden';
      var dx = (to.left + to.width / 2) - (from.left + from.width / 2), dy = (to.top + to.height / 2) - (from.top + from.height / 2), s = to.width / from.width;
      return jb.animate([{ transform: 'none' }, { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(' + s + ')' }], { duration: 700, easing: 'cubic-bezier(.65,0,.2,1)', fill: 'forwards' }).finished
        .then(function () { target.style.visibility = ''; });
    }).then(function () { box.classList.remove('on'); box.removeAttribute('style'); }, function () { H.classList.remove('boot'); box.classList.remove('on'); });
  }

  /* 5. The command bar: grows with the text, Ctrl or Cmd with Enter sends, "/" anywhere comes back to it. */
  function bar() {
    var f = $('#job'); var ta = f && $('textarea', f);
    if (ta) {
      var grow = function () { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight + 2, W.innerHeight * 0.4) + 'px'; };
      ta.addEventListener('input', grow);
      ta.addEventListener('keydown', function (e) { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); if (f.requestSubmit) f.requestSubmit(); } if (e.key === 'Escape') ta.blur(); });
      f.addEventListener('submit', function () { var b = $('button', f); if (b) { b.setAttribute('aria-busy', 'true'); setTimeout(function () { b.removeAttribute('aria-busy'); }, 6000); } });
      if (location.hash === '#ask') ta.focus();
    }
    D.addEventListener('keydown', function (e) {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      var t = e.target; if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (!signedIn) return;
      e.preventDefault();
      if (ta) ta.focus(); else location.href = '/#ask';
    });
  }

  /* 6. A job's stream: a new line arrives with a small rise, and the page follows it when you are at the bottom. */
  function stream() {
    var ol = $('ol.stream'); if (!ol || !W.MutationObserver) return;
    new MutationObserver(function (ms) {
      var atEnd = W.innerHeight + W.scrollY >= D.documentElement.scrollHeight - 160;
      ms.forEach(function (m) { [].forEach.call(m.addedNodes, function (n) { if (n.nodeType === 1) n.classList.add('fresh'); }); });
      if (atEnd) W.scrollTo({ top: D.documentElement.scrollHeight, behavior: REDUCED ? 'auto' : 'smooth' });
    }).observe(ol, { childList: true });
  }

  /* 7. Motion that runs on its own can be paused: the big J is the switch. */
  function pause() {
    var b = $('#calm'); if (!b) return;
    var sync = function () { b.setAttribute('aria-pressed', calm ? 'true' : 'false'); b.setAttribute('aria-label', calm ? b.getAttribute('data-move') : b.getAttribute('data-calm')); };
    sync();
    b.addEventListener('click', function () {
      calm = !calm; H.classList.toggle('calm', calm); sync();
      try { localStorage.setItem('jz-calm', calm ? '1' : '0'); } catch (e) { /* fine */ }
      if (field) { if (calm) { field.stop(); field.redraw(); } else field.start(); }
    });
  }

  var cv = $('#field');
  if (cv) {
    try { field = makeField(cv, $('#presence .jmark.hero')); } catch (e) { field = null; }
    if (field) {
      var st = H.getAttribute('data-state');
      field.energyT = field.energy = st === 'working' ? 1 : 0.12; field.waitT = field.wait = st === 'waiting' ? 1 : 0;
      field.start();
    }
  }
  bar(); stream(); pause();
  if (!H.classList.contains('boot')) liftMark();
  boot().then(function () { if (signedIn) refresh(); });
})();
