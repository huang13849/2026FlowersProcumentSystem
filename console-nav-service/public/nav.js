/*! console-nav.js v1.0 — embeddable unified header (data-app="products|suppliers|...") */
(function(){
  if (window.__GC_NAV_LOADED) return; window.__GC_NAV_LOADED = true;
  var APPS = __APPS_JSON__;
  var script = document.currentScript || (function(){var s=document.getElementsByTagName('script');return s[s.length-1]})();
  var currentApp = (script && script.getAttribute('data-app')) || detectApp();
  function detectApp(){
    var h = location.host, p = location.pathname;
    for (var i=0;i<APPS.length;i++){
      var a = APPS[i], u; try{u=new URL(a.href)}catch(e){continue}
      if (u.host === h && (u.pathname==='/' || p.indexOf(u.pathname)===0)) return a.id;
    }
    return '';
  }

  // Inject CSS from same origin as this script
  var origin = script && script.src ? new URL(script.src).origin : '';
  var link = document.createElement('link');
  link.rel='stylesheet'; link.href = origin + '/nav.css';
  document.head.appendChild(link);

  function build(){
    var shell = document.createElement('div');
    shell.className = 'gc-shell';
    var active = APPS.find(function(a){return a.id===currentApp});
    var accent = active ? active.gradient : 'linear-gradient(90deg,#c084fc,#f472b6)';
    var glow = active ? active.color+'99' : 'rgba(192,132,252,.6)';
    shell.style.setProperty('--gc-accent', accent);
    shell.style.setProperty('--gc-glow', glow);

    var bar = document.createElement('div');
    bar.className='gc-bar';
    bar.innerHTML =
        '<div class="gc-brand" title="花卉采购管理平台"><span>花卉采购管理平台</span></div>'
      + '<div class="gc-tabs" id="gcTabs"></div>'
      + '<div class="gc-actions">'
      +   '<button class="gc-launch" id="gcLaunch">⌘ 门户</button>'
      + '</div>';
    shell.appendChild(bar);
    document.body.insertBefore(shell, document.body.firstChild);
    document.body.classList.add('gc-has-shell');

    var tabs = shell.querySelector('#gcTabs');
    APPS.forEach(function(a){
      var el = document.createElement('a');
      el.className = 'gc-tab' + (a.id===currentApp?' active':'');
      el.href = a.href;
      el.target = a.id===currentApp ? '_self' : '_self';
      el.title = a.name;
      el.innerHTML = '<span style="font-size:15px">'+a.icon+'</span><span>'+a.name+'</span><span class="gc-dot" data-h="'+a.id+'"></span>';
      tabs.appendChild(el);
    });
    shell.querySelector('#gcLaunch').onclick = function(){ location.href = origin + '/console/'; };

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
