/* ============================================================
   【全站听歌挂件】music-widget.js
   ------------------------------------------------------------
   用法：在每个页面的 </body> 前加一行：
       <script src="music-widget.js"></script>

   它做了三件事：
   1. 往页面里塞一个隐藏的 <iframe name="dalangMusic" src="music-player.html">
      —— 用固定的 name，同源导航时浏览上下文会被复用，
         所以换页时音乐不会中断。
   2. 生成右下角的小挂件（歌名/进度/暂停/下一首/关闭）。
   3. 暴露 window.musicPlayer，供页面上的按钮调用。

   页面上的按钮可以这样用：
       <button onclick="musicPlayer.start()">和dalang一起听歌</button>
       <button onclick="musicPlayer.toggle()">暂停/继续</button>
       <button onclick="musicPlayer.stop()">停止听歌</button>
       <button onclick="musicPlayer.playIndex(2)">直接播第 3 首</button>
   ============================================================ */
(function () {
  'use strict';

  var PLAYER_SRC  = 'music-player.html';
  var FRAME_NAME  = 'dalangMusic';      // 必须固定，否则换页会重建 iframe
  var READY_TIMEOUT = 900;              // 超时兜底，避免一直等不到回信

  var frame   = null;
  var ready   = false;
  var isPlaying   = false;
  var currentTitle = '';
  var lastTime = 0, lastDuration = 0;

  /* ---------------- 样式 ---------------- */
  var CSS = [
    '.dw{position:fixed;right:20px;bottom:20px;z-index:9990;display:flex;align-items:center;',
    'gap:11px;padding:10px 12px 10px 14px;background:rgba(20,20,20,.93);',
    '-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);border:1px solid #303030;',
    'border-radius:999px;box-shadow:0 10px 30px rgba(0,0,0,.55);',
    'transform:translateY(20px) scale(.92);opacity:0;visibility:hidden;pointer-events:none;',
    'transition:transform .3s cubic-bezier(.2,.8,.2,1),opacity .3s ease,visibility .3s ease;',
    'font-family:"Lora","LXGW WenKai","PingFang SC","Microsoft YaHei",sans-serif;}',
    '.dw.show{transform:translateY(0) scale(1);opacity:1;visibility:visible;pointer-events:auto;}',
    '.dw .eq{display:flex;align-items:flex-end;gap:2px;height:16px;flex:0 0 auto;}',
    '.dw .eq span{width:3px;border-radius:2px;background:#1db954;animation:dwEq 1s ease-in-out infinite;}',
    '.dw .eq span:nth-child(1){height:60%;animation-delay:0s}',
    '.dw .eq span:nth-child(2){height:100%;animation-delay:.18s}',
    '.dw .eq span:nth-child(3){height:45%;animation-delay:.36s}',
    '.dw .eq span:nth-child(4){height:80%;animation-delay:.54s}',
    '@keyframes dwEq{0%,100%{transform:scaleY(.45)}50%{transform:scaleY(1)}}',
    '.dw.paused .eq span{animation-play-state:paused;opacity:.45}',
    '.dw .info{min-width:0;}',
    '.dw .now{font-size:13px;color:#eee;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:240px;}',
    '.dw .now b{color:#1db954;font-weight:700;}',
    '.dw .time{font-size:11px;color:#888;margin-top:2px;font-variant-numeric:tabular-nums;}',
    '.dw .btn{width:30px;height:30px;border-radius:50%;border:none;background:#2c2c2c;color:#ddd;',
    'font-size:13px;line-height:1;cursor:pointer;flex:0 0 auto;display:grid;place-items:center;',
    'transition:background .18s ease,color .18s ease;}',
    '.dw .btn:hover{background:#3a3a3a;color:#fff;}',
    '.dw .btn.close:hover{background:#e11d48;color:#fff;}',
    '@media (max-width:768px){.dw{left:12px;right:12px;bottom:12px;}',
    '.dw .now{max-width:none;}.dw .info{flex:1;}}',
    '@media (prefers-reduced-motion:reduce){.dw .eq span{animation:none;}}'
  ].join('');

  function injectStyle() {
    if (document.getElementById('dw-style')) return;
    var s = document.createElement('style');
    s.id = 'dw-style';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  /* ---------------- 隐藏的播放器 iframe ---------------- */
  function injectFrame() {
    // 页面作者如果自己写了 iframe（比如 gym.html 里要显示歌单），就用它
    frame = document.querySelector('iframe[name="' + FRAME_NAME + '"]');
    if (frame) return;

    frame = document.createElement('iframe');
    frame.name = FRAME_NAME;
    frame.src = PLAYER_SRC;
    frame.setAttribute('allow', 'autoplay');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:absolute;width:0;height:0;border:0;visibility:hidden;';
    document.body.appendChild(frame);
  }

  /* ---------------- 小挂件 ---------------- */
  var widget, nowEl, timeEl, playBtn;

  function buildWidget() {
    widget = document.createElement('div');
    widget.className = 'dw';
    widget.setAttribute('role', 'status');
    widget.setAttribute('aria-live', 'polite');
    widget.innerHTML =
      '<div class="eq" aria-hidden="true"><span></span><span></span><span></span><span></span></div>' +
      '<div class="info">' +
        '<div class="now">和 <b>dalang</b> 一起听：<span class="dw-title">—</span></div>' +
        '<div class="time">0:00 / 0:00</div>' +
      '</div>' +
      '<button class="btn dw-play" type="button" aria-label="暂停或继续">II</button>' +
      '<button class="btn dw-next" type="button" aria-label="下一首">&rsaquo;</button>' +
      '<button class="btn close dw-close" type="button" aria-label="结束听歌">&#10005;</button>';

    document.body.appendChild(widget);

    nowEl   = widget.querySelector('.dw-title');
    timeEl  = widget.querySelector('.time');
    playBtn = widget.querySelector('.dw-play');

    playBtn.addEventListener('click', function () { api.toggle(); });
    widget.querySelector('.dw-next').addEventListener('click', function () { api.next(); });
    widget.querySelector('.dw-close').addEventListener('click', function () { api.stop(); });
  }

  /* ---------------- 供页面渲染歌单 ----------------
     页面里这样用：
       var songs = musicPlayer.songs();     // 取歌单数组
       musicPlayer.playIndex(2);            // 播第 3 首
     监听状态变化来高亮当前曲目：
       document.addEventListener('musicstatechange', function(e){
         console.log(e.detail.index, e.detail.playing);
       });
  ------------------------------------------------- */
  var trackList = [];

  function fmt(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    var m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function render() {
    if (!widget) return;

    /* 挂件显示条件：正在播放时显示，暂停时收起；
       结束听歌或播完（没有曲目）也收起。 */
    widget.classList.toggle('show', isPlaying);
    widget.classList.toggle('paused', !isPlaying && lastDuration > 0);
    if (nowEl)  nowEl.textContent = currentTitle || '—';
    if (timeEl) timeEl.textContent = fmt(lastTime) + ' / ' + fmt(lastDuration);
    if (playBtn) playBtn.textContent = isPlaying ? 'II' : '▶';
  }

  /* ---------------- 与 iframe 通信 ---------------- */
  function send(action, extra) {
    if (!frame || !frame.contentWindow) return;
    var msg = { target: 'dalang-music', action: action };
    if (extra) for (var k in extra) msg[k] = extra[k];
    try { frame.contentWindow.postMessage(msg, '*'); } catch (e) {}
  }

  // 页面加载完主动问一次状态；iframe 若是新加载的（没有会话状态）也能拿到 ready
  var asked = false;
  function askOnce() {
    if (asked) return;
    asked = true;
    send('getState');
  }

  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || d.source !== 'dalang-music') return;

    ready = true;
    if (d.type === 'ready') { send('getState'); return; }

    if (d.songs && d.songs.length) trackList = d.songs;

    isPlaying    = !!d.playing;
    currentTitle = d.title || '';
    lastTime     = d.time || 0;
    lastDuration = d.duration || 0;

    render();
    document.dispatchEvent(new CustomEvent('musicstatechange', { detail: d }));
  });

  /* ---------------- 对外接口 ---------------- */
  var api = {
    /* 点「和dalang一起听歌」用这个：
       已经在放歌 → 暂停/继续；全新开始 → 从第 1 首播 */
    start: function () {
      if (currentTitle) { send('toggle'); return; }
      isPlaying = true;
      send('playIndex', { index: 0 });
      render();
    },
    toggle: function () { send('toggle'); },
    pause:  function () { send('pause'); },
    next:   function () { send('next'); },
    stop:   function () {
      isPlaying = false;
      send('stop');
      render();
    },
    playIndex: function (i) {
      isPlaying = true;
      send('playIndex', { index: i });
      render();
    },
    songs: function () { return trackList.slice(); },
    isPlaying: function () { return isPlaying; },
    current: function () { return { title: currentTitle, playing: isPlaying, time: lastTime, duration: lastDuration }; }
  };

  window.musicPlayer = api;

  /* ---------------- 启动 ---------------- */
  function boot() {
    injectStyle();
    injectFrame();
    buildWidget();
    render();

    // iframe 加载完成后问一次状态（新页面场景）
    frame.addEventListener('load', function () {
      setTimeout(function () { send('getState'); }, 60);
    });

    // 兜底：万一 iframe 没回信，也要让按钮可用
    setTimeout(askOnce, READY_TIMEOUT);

    // Esc 结束听歌
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && isPlaying) api.stop();
    });

    // 离开页面时只保存状态，不停止播放
    window.addEventListener('pagehide', function () {
      send('getState');
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
