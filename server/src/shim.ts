// The artifact runtime's window.claude, served by this server at /_/shim.js (spec §1 part 3). ES5 on purpose: TVs and
// old phones run it. Page scripts (tracker.js STATE_JS, ANSWER_JS, MOTION_JS) call use("db") and hot.*.
// - use("db") gives the page's `answers` collection over HTTP: doc(id).set(a) is a PUT, onSnapshot a GET now and again
//   on every `answers` event for this page. The TV view and a page with no id get no database.
// - hot carries what the page scripts snapshot across a reload (sessionStorage, used once), as a republish did.
// - A 400 is `bad-request` (the page says "could not send"); only `invalid_argument` means the feature is off and hides forms.
// - A 401 anywhere (the session ended, the server restarted with a new key) shows one "Signed out — sign in again"
//   banner with a link back to this page; it never reloads, so there is no loop and no form silently hidden.
// - Live: /events (SSE). A change in this page's folder reloads it (debounced); a reset reloads it; with no
//   EventSource, or a stream that keeps failing (three drops without a reopen in between), /api/stamp is polled every 10 s instead and the
//   page's answers are re-read on each tick (the stamp leaves answers.json out).
export const SHIM_JS = `(function(){
var W=window,D=W.document,m=D.querySelector('meta[name="joserah-page"]'),page=m?m.getAttribute('content'):'';
var mm=D.querySelector('meta[name="joserah-mode"]'),mode=mm?mm.getAttribute('content'):'page';
var tr=String(D.documentElement.lang||'').slice(0,2)==='tr',KEY='jh:hot:'+W.location.pathname,data={},snaps=[],listeners=[];
try{var s=W.sessionStorage.getItem(KEY);if(s){data=JSON.parse(s)||{};W.sessionStorage.removeItem(KEY)}}catch(e){}
function banner(){if(D.getElementById('jh-out'))return;var b=D.createElement('div');b.id='jh-out';b.setAttribute('role','alert');
b.style.cssText='position:fixed;left:0;right:0;top:0;z-index:99;padding:12px 16px;background:#fff3cd;color:#111;font:16px/1.4 system-ui,sans-serif;border-bottom:1px solid #111';
b.appendChild(D.createTextNode(tr?'Oturum kapandı — ':'Signed out — '));var a=D.createElement('a');a.href='/login?next='+encodeURIComponent(W.location.pathname+W.location.search);
a.textContent=tr?'yeniden giriş yapın':'sign in again';b.appendChild(a);(D.body||D.documentElement).appendChild(b)}
function api(method,url,body){return W.fetch(url,{method:method,credentials:'same-origin',headers:body!==undefined?{'Content-Type':'application/json'}:{},body:body!==undefined?JSON.stringify(body):undefined})
.then(function(r){if(r.status===401){banner();throw{code:'signed-out'}}if(r.status===409)throw{code:'conflict'};if(r.status===400)throw{code:'bad-request'};if(!r.ok)throw{code:'http-'+r.status};return r.json()})}
function snapshot(){return api('GET','/api/db/'+page+'/answers').then(function(j){var docs=[];var l=(j&&j.docs)||[];for(var i=0;i<l.length;i++)(function(d){docs.push({id:d.id,exists:true,data:function(){return d.data}})})(l[i]);return{docs:docs}})}
function refresh(){snapshot().then(function(s){for(var i=0;i<listeners.length;i++)try{listeners[i][0](s)}catch(e){}},function(e){for(var i=0;i<listeners.length;i++)if(listeners[i][1])try{listeners[i][1](e)}catch(x){}})}
var col={doc:function(id){return{set:function(a){return api('PUT','/api/db/'+page+'/answers/'+encodeURIComponent(id),a).then(function(){})}}},
onSnapshot:function(cb,err){var l=[cb,err];listeners.push(l);refresh();return function(){var i=listeners.indexOf(l);if(i>=0)listeners.splice(i,1)}}};
var db={collection:function(n){if(n!=='answers')throw{code:'invalid_argument'};return col}};
W.claude={use:function(name){if(name!=='db'||mode==='tv'||!page)return Promise.reject({code:'capability_disabled'});return Promise.resolve(db)},
hot:{data:data,snapshot:function(fn){snaps.push(fn)},ready:function(cb){try{cb(data)}catch(e){}}}};
function reload(){var out={};for(var i=0;i<snaps.length;i++){try{var v=snaps[i]();if(v&&typeof v==='object')for(var k in v)out[k]=v[k]}catch(e){}}
try{W.sessionStorage.setItem(KEY,JSON.stringify(out))}catch(e){}W.location.reload()}
var t=0,loaded=Date.now();function soon(){clearTimeout(t);t=setTimeout(reload,Math.max(400,1500-(Date.now()-loaded)))}
if(!page)return;var folder='.joserah/desk/artifacts/'+page+'/';
function onEvent(e){if(!e)return;if(e.type==='answers'&&e.page===page)refresh();else if(e.type==='changed'&&String(e.path).indexOf(folder)===0)soon();else if(e.type==='reset')soon()}
var polling=false,stamp=null;function poll(){if(polling)return;polling=true;setInterval(function(){if(listeners.length)refresh();api('GET','/api/stamp/'+page).then(function(j){if(stamp!==null&&j.stamp!==stamp)reload();stamp=j.stamp},function(){})},10000)}
if(typeof W.EventSource==='undefined'){poll();return}
var fails=0,es=W.jzES=new W.EventSource('/events');es.onopen=function(){fails=0};es.onmessage=function(m){fails=0;try{onEvent(JSON.parse(m.data))}catch(x){}};
es.onerror=function(){fails++;if(es.readyState===2){api('GET','/api/me').then(function(){poll()},function(){})}else if(fails>=3){es.close();poll()}};
})();`;
