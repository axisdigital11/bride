/* ax-track — מעקב נוכחות + הקלטת סשנים לאתר bride.
   נטען עם defer ומתעורר רק אחרי window.load + 1.5 שניות, כדי לא לגעת בזמן הטעינה.
   לא מוסיף שום אלמנט לדף ולא נוגע בעיצוב. הכל עטוף try/catch ונכשל בשקט.
   דפי צ'קאאוט לעולם לא מוקלטים (פרטי תשלום ופרטים אישיים). */
/* ax-track — מעקב נוכחות + הקלטת סשנים לאתר bride.
   להדבקה ב-GTM (GTM-PGZ4LR6K) כתגית Custom HTML, טריגר: All Pages.
   כלל ברזל: לא נוגע באתר ולא שובר שום דף — הכל עטוף try/catch ונכשל בשקט.
   דפי צ'קאאוט לעולם לא מוקלטים (פרטי תשלום ופרטים אישיים). */
(function () {
  'use strict';
  try {

    var API = 'https://bride-payment.axis-office11.workers.dev';
    var RRWEB_CDN = 'vendor/rrweb.min.js';  // מתארח אצלנו, בלי תלות ב-CDN
    var BEAT_MS = 45000;      // דופק נוכחות כל 45 שניות
    var FLUSH_MS = 25000;     // שליחת צ'אנק הקלטה כל 25 שניות
    var MAX_REC_MS = 300000;  // עוצרים הקלטה אחרי 5 דקות
    var MAX_CHUNKS = 20;      // תקרת צ'אנקים לסשן (תואם לתקרה בשרת)

    if (window.__axTrackLoaded) return; // הגנה מפני ירי כפול של התגית
    window.__axTrackLoaded = true;

    var SS = {
      get: function (k) { try { return window.sessionStorage.getItem(k); } catch (e) { return null; } },
      set: function (k, v) { try { window.sessionStorage.setItem(k, v); } catch (e) {} }
    };

    function clip(s, n) {
      s = s == null ? '' : String(s);
      return s.length > n ? s.slice(0, n) : s;
    }

    /* ── זהות הסשן ──────────────────────────────────────────────────────── */
    var sid = SS.get('ax_sid');
    if (!sid) {
      sid = (Date.now().toString(36) + Math.random().toString(36).slice(2, 10)).slice(0, 20);
      SS.set('ax_sid', sid);
    }
    var t0 = parseInt(SS.get('ax_t0'), 10);
    if (!t0 || isNaN(t0)) { t0 = Date.now(); SS.set('ax_t0', String(t0)); }

    /* ── איסוף חד-פעמי ──────────────────────────────────────────────────── */
    var path = '/';
    try { path = location.pathname || '/'; } catch (e) {}

    var page = 'index.html';
    try { page = path.split('/').pop() || 'index.html'; } catch (e) {}

    // אף פעם לא מקליטים צ'קאאוט — בדיקה על כל הנתיב, לא רק על שם הקובץ
    var IS_CHECKOUT = path.toLowerCase().indexOf('checkout') !== -1;

    var ref = '';
    try { ref = clip(document.referrer || '', 120); } catch (e) {}

    var utm = '';
    try {
      var q = new URLSearchParams(location.search);
      var parts = [];
      ['utm_source', 'utm_medium', 'utm_campaign'].forEach(function (k) {
        var v = q.get(k);
        if (v) parts.push(k.replace('utm_', '') + '=' + v);
      });
      utm = clip(parts.join('|'), 80);
    } catch (e) {}

    var w = 0, h = 0, dev = 'desktop';
    try {
      w = window.innerWidth || 0;
      h = window.innerHeight || 0;
      dev = w < 768 ? 'mobile' : (w < 1024 ? 'tablet' : 'desktop');
    } catch (e) {}

    var ua = '';
    try { ua = clip(navigator.userAgent || '', 80); } catch (e) {}

    /* ── תקשורת ─────────────────────────────────────────────────────────── */
    // keepalive מוגבל ל-64KB גוף — מתאים ל-beat הקטן, לא לצ'אנקים של rrweb
    function post(pathName, body, keepalive) {
      try {
        var opts = {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        };
        if (keepalive) opts.keepalive = true;
        return fetch(API + pathName, opts);
      } catch (e) {
        return Promise.reject(e);
      }
    }

    function postFinal(pathName, body) {
      // שליחה אחרונה בזמן עזיבת הדף — sendBeacon עם text/plain (בלי preflight).
      // גם ל-sendBeacon וגם ל-keepalive יש תקרת 64KB, ולכן יש נפילה אחורה ל-fetch רגיל.
      try {
        var payload = JSON.stringify(body);
        if (navigator.sendBeacon && payload.length < 60000) {
          var blob = new Blob([payload], { type: 'text/plain;charset=UTF-8' });
          if (navigator.sendBeacon(API + pathName, blob)) return;
        }
        if (payload.length < 60000) {
          post(pathName, body, true).catch(function () { post(pathName, body).catch(function () {}); });
          return;
        }
      } catch (e) {}
      try { post(pathName, body).catch(function () {}); } catch (e) {}
    }

    /* ── דופק נוכחות ────────────────────────────────────────────────────── */
    var beatTimer = null;
    var firstBeatDone = false;

    function beat() {
      post('/t/beat', { sid: sid, page: page, ref: ref, utm: utm, dev: dev, w: w, h: h }, true)
        .then(function (r) { return r && r.json ? r.json() : null; })
        .then(function (data) {
          if (firstBeatDone) return;
          firstBeatDone = true;
          var decision = SS.get('ax_rec');
          if (decision === null) {
            decision = (data && data.rec) ? '1' : '0';
            SS.set('ax_rec', decision);
          }
          if (decision === '1') scheduleRecorder();
        })
        .catch(function () {
          if (firstBeatDone) return;
          firstBeatDone = true;
          // אין תשובה מהשרת — אם כבר הוחלט קודם בביקור הזה, ממשיכים לפי ההחלטה
          if (SS.get('ax_rec') === '1') scheduleRecorder();
        });
    }

    function startBeats() {
      if (beatTimer) return;
      try { beat(); } catch (e) {}
      beatTimer = setInterval(function () { try { beat(); } catch (e) {} }, BEAT_MS);
    }

    function stopBeats() {
      if (beatTimer) { clearInterval(beatTimer); beatTimer = null; }
    }

    /* ── הקלטה (rrweb, נטען מה-CDN בעצלתיים) ────────────────────────────── */
    var buffer = [];
    var stopFn = null;
    var flushTimer = null;
    var recStarted = false;
    var recDone = false;

    function seqNext() {
      var n = parseInt(SS.get('ax_seq'), 10);
      if (!n || isNaN(n) || n < 0) n = 0;
      SS.set('ax_seq', String(n + 1));
      return n;
    }

    function seqPeek() {
      var n = parseInt(SS.get('ax_seq'), 10);
      return (!n || isNaN(n)) ? 0 : n;
    }

    function meta() {
      return {
        t0: t0, page: page, dur: Date.now() - t0, dev: dev,
        ref: ref, utm: utm, w: w, h: h, ua: ua
      };
    }

    function flush(final) {
      try {
        if (!buffer.length) return;
        var seq = seqPeek();
        if (seq > MAX_CHUNKS) { stopRecording(); return; }
        var events = buffer;
        buffer = [];
        seqNext();
        var body = { sid: sid, seq: seq, events: events, meta: meta() };
        if (final) postFinal('/t/rec', body);
        else post('/t/rec', body).catch(function () {});
        if (seq >= MAX_CHUNKS) stopRecording();
      } catch (e) {}
    }

    function stopRecording() {
      recDone = true;
      try { if (stopFn) stopFn(); } catch (e) {}
      stopFn = null;
      if (flushTimer) { clearInterval(flushTimer); flushTimer = null; }
    }

    function scheduleRecorder() {
      if (IS_CHECKOUT) return;              // צ'קאאוט לא מוקלט. נקודה.
      if (recStarted || recDone) return;
      if (seqPeek() >= MAX_CHUNKS) return;
      recStarted = true;

      var kick = function () {
        // עיכוב 1500ms אחרי load — כדי לא להתחרות ב-LCP של דף הנחיתה (תנועה בתשלום)
        setTimeout(function () { try { loadRrweb(); } catch (e) {} }, 1500);
      };
      if (document.readyState === 'complete') kick();
      else window.addEventListener('load', kick, { once: true });
    }

    function loadRrweb() {
      if (window.rrweb && window.rrweb.record) { startRecording(); return; }
      var s = document.createElement('script');
      s.src = RRWEB_CDN;
      s.async = true;
      s.crossOrigin = 'anonymous';
      s.onload = function () { try { startRecording(); } catch (e) {} };
      s.onerror = function () {}; // CDN חסום — נכשל בשקט, האתר לא מושפע
      (document.head || document.documentElement).appendChild(s);
    }

    function startRecording() {
      try {
        var rec = (window.rrweb && window.rrweb.record) || window.rrwebRecord;
        if (!rec || recDone || IS_CHECKOUT) return;

        stopFn = rec({
          emit: function (e) { try { buffer.push(e); } catch (err) {} },
          maskAllInputs: true,
          maskTextClass: 'ax-mask',
          blockClass: 'ax-block',
          sampling: { mousemove: 100, scroll: 150, input: 'last' },
          recordCanvas: false,
          collectFonts: false
        });

        // שליחה מוקדמת: הצ'אנק הראשון מכיל את הסנאפשוט המלא והוא הכבד ביותר —
        // מוציאים אותו ב-fetch רגיל ולא משאירים אותו ל-sendBeacon (תקרת 64KB)
        setTimeout(function () { try { flush(false); } catch (e) {} }, 4000);

        flushTimer = setInterval(function () { try { flush(false); } catch (e) {} }, FLUSH_MS);
        setTimeout(function () { try { flush(false); stopRecording(); } catch (e) {} }, MAX_REC_MS);
      } catch (e) {}
    }

    /* ── מחזור חיי הדף ──────────────────────────────────────────────────── */
    function onHidden() {
      stopBeats();
      try { flush(true); } catch (e) {}
    }

    try {
      document.addEventListener('visibilitychange', function () {
        try {
          if (document.hidden) onHidden();
          else startBeats();
        } catch (e) {}
      });
      window.addEventListener('pagehide', function () { try { onHidden(); } catch (e) {} });
    } catch (e) {}

    try {
      if (!document.hidden) startBeats();
    } catch (e) { try { startBeats(); } catch (e2) {} }

  } catch (e) { /* fail silent — לעולם לא שוברים את הדף */ }
})();
