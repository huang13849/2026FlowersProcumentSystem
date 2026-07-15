/*! console-nav.js v2 — 拉伸抽屉 × 悬停展开 × 一键固定 */
(function(){
  if (window.__GC_NAV_LOADED) return; window.__GC_NAV_LOADED = true;
  var APPS = __APPS_JSON__;
  var script = document.currentScript || (function(){var s=document.getElementsByTagName('script');return s[s.length-1]})();
  var currentApp = (script && script.getAttribute('data-app')) || detectApp();
  var origin = script && script.src ? new URL(script.src).origin : '';

  function detectApp(){
    var h = location.host, p = location.pathname;
    for (var i=0;i<APPS.length;i++){
      var a = APPS[i], u; try{u=new URL(a.href)}catch(e){continue}
      if (u.host === h && (u.pathname==='/' || p.indexOf(u.pathname)===0)) return a.id;
    }
    return '';
  }

  // Inject CSS
  var link = document.createElement('link');
  link.rel='stylesheet'; link.href = origin + '/nav.css';
  document.head.appendChild(link);

  function build(){
    var shell = document.createElement('div');
    shell.className = 'gc-shell';
    var active = APPS.find(function(a){return a.id===currentApp});
    if (active) {
      shell.style.setProperty('--gc-accent', active.gradient);
      shell.style.setProperty('--gc-glow', active.color+'aa');
    }

    var pinned = localStorage.getItem('gcNavPinned') === '1';
    if (pinned) { shell.classList.add('on','pinned'); document.body.classList.add('gc-pinned'); }

    // trigger strip
    var trig = document.createElement('div');
    trig.className='gc-trigger';
    trig.title='悬停展开导航 · 点击固定';
    shell.appendChild(trig);

    // main bar
    var bar = document.createElement('div');
    bar.className='gc-bar';
    bar.innerHTML =
        '<div class="gc-brand" title="花卉采购管理平台"><span>花卉采购管理平台</span></div>'
      + '<div class="gc-tabs" id="gcTabs"></div>'
      + '<div class="gc-actions">'
      +   '<button class="gc-pin" id="gcPin" title="固定/取消固定顶部">📌 <span id="gcPinTxt">'+(pinned?'已固定':'固定')+'</span></button>'
      +   '<button class="gc-launch" id="gcLaunch">⌘ 门户</button>'
      + '</div>';
    shell.appendChild(bar);
    document.body.insertBefore(shell, document.body.firstChild);

    var tabs = shell.querySelector('#gcTabs');
    APPS.forEach(function(a,i){
      var el = document.createElement('a');
      el.className = 'gc-tab' + (a.id===currentApp?' active':'');
      el.href = a.href;
      el.target = '_self';
      el.title = a.name;
      el.style.setProperty('--gc-d', (0.05 + i*0.055)+'s');
      el.innerHTML =
        '<span class="gc-ic">'+a.icon+'</span>'
      + '<span>'+a.name+'</span>'
      + '<span class="gc-dot" data-h="'+a.id+'"></span>';
      tabs.appendChild(el);
    });

    // Hover expand (unless pinned)
    var closeTimer;
    function expand(){ clearTimeout(closeTimer); shell.classList.add('on'); }
    function collapse(){
      if (shell.classList.contains('pinned')) return;
      closeTimer = setTimeout(function(){ shell.classList.remove('on'); }, 250);
    }
    trig.addEventListener('mouseenter', expand);
    bar.addEventListener('mouseenter', expand);
    shell.addEventListener('mouseleave', collapse);

    // Click trigger to toggle pin
    trig.addEventListener('click', function(){ togglePin(); });
    shell.querySelector('#gcPin').addEventListener('click', function(e){ e.stopPropagation(); togglePin(); });
    function togglePin(){
      var isPinned = shell.classList.toggle('pinned');
      shell.querySelector('#gcPinTxt').textContent = isPinned?'已固定':'固定';
      document.body.classList.toggle('gc-pinned', isPinned);
      if (isPinned) shell.classList.add('on'); else shell.classList.remove('on');
      localStorage.setItem('gcNavPinned', isPinned?'1':'0');
    }
    shell.querySelector('#gcLaunch').addEventListener('click', function(e){
      e.stopPropagation();
      location.href = origin + '/console/';
    });

    // Keyboard shortcut: ⌘/Ctrl + K toggles expand
    document.addEventListener('keydown', function(e){
      if ((e.metaKey||e.ctrlKey) && e.key.toLowerCase()==='k') {
        e.preventDefault();
        if (shell.classList.contains('on') && !shell.classList.contains('pinned')) shell.classList.remove('on');
        else shell.classList.add('on');
      }
    });

    // Health poll
    fetch(origin + '/api/nav/health').then(function(r){return r.json()}).then(function(d){
      (d.data||[]).forEach(function(h){
        var dot = shell.querySelector('[data-h="'+h.id+'"]');
        if(dot && h.status!=='up') dot.classList.add('down');
      });
    }).catch(function(){});
  }

  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();
