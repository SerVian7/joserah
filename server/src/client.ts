// Home and job pages: the job box and the live job lines. ES5, textContent only.
export const APP_JS = `(function(){
var D=document;function $(s,r){return (r||D).querySelector(s)}function all(s){return D.querySelectorAll(s)}
function post(url,body){return fetch(url,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body||{})}).then(function(r){return r.json().then(function(j){if(r.status===401)location.href='/login?next='+encodeURIComponent(location.pathname);if(!r.ok)throw j;return j})})}
var f=$('#job');if(f)f.addEventListener('submit',function(e){e.preventDefault();var t=$('textarea',f),ty=$('select',f),err=$('.row .err',f);err.textContent='';
post('/api/jobs',{text:t.value,type:ty?ty.value:'task'}).then(function(j){location.href='/jobs/'+j.id},function(x){err.textContent=(x&&(x.reason||x.message||x.error))||'error'})});
Array.prototype.forEach.call(all('button[data-act]'),function(b){b.addEventListener('click',function(){var id=b.getAttribute('data-id'),act=b.getAttribute('data-act'),body={};
if(act==='file'){var ti=$('#file-title');post('/api/query/'+id+'/file',{title:ti?ti.value:''}).then(function(j){location.href='/w/page/'+j.path.replace(/^\\.joserah\\/knowledge\\//,'')},function(x){alert((x&&(x.message||x.error))||'error')});return}
if(act==='reply'){var ta=$('#reply-text');body.text=ta?ta.value:'';}post('/api/jobs/'+id+'/'+act,body).then(function(j){location.href='/jobs/'+j.id},function(x){alert((x&&(x.message||x.error))||'error')})})});
var ask=$('#ask');if(ask)ask.addEventListener('submit',function(e){e.preventDefault();var err=$('.err',ask);err.textContent='';
post('/api/query',{question:$('textarea',ask).value}).then(function(j){location.href='/jobs/'+j.id},function(x){err.textContent=(x&&(x.reason||x.message||x.error))||'error'})});
var up=$('#upload');if(up)up.addEventListener('submit',function(e){e.preventDefault();var err=$('.err',up),fd=new FormData(up);err.textContent='';
fetch('/api/ingest',{method:'POST',credentials:'same-origin',body:fd}).then(function(r){if(r.status===401)location.href='/login?next='+encodeURIComponent(location.pathname);return r.json().then(function(j){if(!r.ok)throw j;return j})})
.then(function(j){location.href=j.id?'/jobs/'+j.id:'/'},function(x){err.textContent=(x&&(x.message||x.error))||'error'})});
if(typeof EventSource==='undefined')return;var es=window.jzES=new EventSource('/events');
es.onmessage=function(m){var e;try{e=JSON.parse(m.data)}catch(x){return}
function typing(){var r=$('#reply-text'),t=$('#job textarea'),a=$('#ask textarea');return (r&&r.value)||(t&&t.value)||(a&&a.value)}
if(e.type==='reset'&&!typing()){location.reload();return}
if(e.type==='job'){Array.prototype.forEach.call(all('[data-job="'+e.id+'"]'),function(el){var ev=e.event||{};
if(el.tagName==='OL'&&(ev.kind==='text'||ev.kind==='tool')){var li=D.createElement('li');li.className=ev.kind;li.textContent=ev.kind==='tool'?'· '+ev.name:ev.text;el.appendChild(li)}
if(ev.kind==='result'&&el.tagName==='OL'&&!typing())setTimeout(function(){location.reload()},500);
var st=$('.state',el);if(ev.kind==='state')el.setAttribute('data-state',ev.state);if(st&&ev.kind==='state')st.textContent=ev.state;if(st&&ev.kind==='result')st.textContent=ev.ok?'done':'ended';
var last=$('.last',el);if(last&&(ev.kind==='text'||ev.kind==='tool'))last.textContent=ev.kind==='tool'?'· '+ev.name:String(ev.text).slice(0,160)})}
if(e.type==='jobs'&&$('#running')&&!window.jzLive&&!($('#job textarea')&&$('#job textarea').value))location.reload()};
})();`;
