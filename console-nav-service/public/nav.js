/*! console-nav.js v4 — 常驻头部 · 当前 tab 常显 · 多 tab 横向滑动 */
(function(){
  if (window.__GC_NAV_LOADED) return; window.__GC_NAV_LOADED = true;
  var APPS = __APPS_JSON__;
  var script = document.currentScript || (function(){var s=document.getElementsByTagName('script');return s[s.length-1]})();
  var currentApp = (script && script.getAttribute('data-app')) || detectApp();
  var origin = script && script.src ? new URL(script.src).origin : '';

  function detectApp(){
    var h = location.host, p = location.pathname;
    for (var i=0;i<APPS.length;i++){
      var a=APPS[i],u; try{u=new URL(a.href)}catch(e){continue}
      if (u.host===h && (u.pathname==='/'||p.indexOf(u.pathname)===0)) return a.id;
    }
    return '';
  }

  var link=document.createElement('link');
  link.rel='stylesheet'; link.href=origin+'/nav.css';
  document.head.appendChild(link);

  function scrollActiveIntoView(tabs){
    var active=tabs.querySelector('.gc-tab.active');
    if (active && typeof active.scrollIntoView==='function'){
      try { active.scrollIntoView({ inline:'center', block:'nearest', behavior:'smooth' }); } catch(e){}
    }
  }

  function build(){
    var shell=document.createElement('div');
    shell.className='gc-shell';
    var active=APPS.find(function(a){return a.id===currentApp});
    if (active){shell.style.setProperty('--gc-accent',active.gradient);shell.style.setProperty('--gc-glow',active.color+'aa')}

    var bar=document.createElement('div');
    bar.className='gc-bar';
    bar.innerHTML=
        '<div class="gc-brand" title="花卉采购管理平台"><span>花卉采购管理平台</span></div>'
      + '<div class="gc-tabs-wrap">'
      + '  <button class="gc-arrow gc-arrow-left" id="gcArrowL" aria-label="向左滚动" title="向左滚动">‹</button>'
      + '  <div class="gc-tabs" id="gcTabs"></div>'
      + '  <button class="gc-arrow gc-arrow-right" id="gcArrowR" aria-label="向右滚动" title="向右滚动">›</button>'
      + '</div>'
      + '<div class="gc-actions"><button class="gc-launch" id="gcLaunch">⌘ 门户</button></div>';
    shell.appendChild(bar);
    document.body.insertBefore(shell,document.body.firstChild);
    document.body.classList.add('gc-has-shell');

    var tabs=shell.querySelector('#gcTabs');
    var activeIdx=APPS.findIndex(function(a){return a.id===currentApp});
    if (activeIdx<0) activeIdx=0;

    APPS.forEach(function(a,i){
      var el=document.createElement('a');
      el.className='gc-tab'+(a.id===currentApp?' active':'');
      el.href=a.href; el.target='_self'; el.title=a.name;
      var dist=Math.abs(i-activeIdx);
      el.style.setProperty('--gc-d',(0.03+dist*0.06)+'s');
      el.innerHTML='<span class="gc-ic">'+a.icon+'</span><span class="gc-lbl">'+a.name+'</span><span class="gc-dot" data-h="'+a.id+'"></span>';
      tabs.appendChild(el);
    });

    // 初次渲染后把 active 滚到中间
    setTimeout(function(){ scrollActiveIntoView(tabs); }, 60);

    // 鼠标进入 tab 区 或 整个 shell → 展开;离开 → 折叠
    var t;
    function open(){clearTimeout(t);shell.classList.add('on');setTimeout(function(){scrollActiveIntoView(tabs);},80);}
    function close(){t=setTimeout(function(){shell.classList.remove('on')},220)}
    shell.addEventListener('mouseenter',open);
    shell.addEventListener('mouseleave',close);
    shell.querySelector('.gc-tab.active')?.addEventListener('click',function(e){
      if (!shell.classList.contains('on')){e.preventDefault();open()}
    });

    // 桌面箭头按钮: 滚动 1 个 tab 宽度
    function arrowScroll(dir){
      var step = Math.max(160, tabs.clientWidth * 0.6);
      tabs.scrollBy({ left: dir * step, behavior: 'smooth' });
    }
    shell.querySelector('#gcArrowL').addEventListener('click', function(e){ e.stopPropagation(); arrowScroll(-1); });
    shell.querySelector('#gcArrowR').addEventListener('click', function(e){ e.stopPropagation(); arrowScroll(1); });

    // 当 tab 被 click 跳页前主动 scrollIntoView (新页打开也会生效,但用户当前页内点击应该同步视觉)
    shell.querySelectorAll('.gc-tab').forEach(function(el){
      el.addEventListener('click', function(){
        try { el.scrollIntoView({ inline:'center', block:'nearest', behavior:'smooth' }); } catch(e){}
      });
    });

    // Ctrl/⌘ + K toggle
    document.addEventListener('keydown',function(e){
      if ((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();shell.classList.toggle('on')}
    });

    shell.querySelector('#gcLaunch').addEventListener('click',function(e){
      e.stopPropagation(); location.href=origin+'/console/';
    });

    // Health poll
    fetch(origin+'/api/nav/health').then(function(r){return r.json()}).then(function(d){
      (d.data||[]).forEach(function(h){
        var dot=shell.querySelector('[data-h="'+h.id+'"]');
        if(dot&&h.status!=='up') dot.classList.add('down');
      });
    }).catch(function(){});
  }

  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded',build);
  else build();
})();