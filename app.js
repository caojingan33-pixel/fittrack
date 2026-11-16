/* ==========================================================
   FitTrack · 训练日记（第一版）
   纯前端、零依赖；数据存 localStorage
   ========================================================== */
(function () {
  'use strict';

  var KEY = 'fittrack.v1';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* ---------------- 基础工具 ---------------- */
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function today() { return ymd(new Date()); }
  function parseYmd(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function addDays(s, n) { var d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function num(v, d) { var n = parseFloat(v); return isFinite(n) ? n : (d || 0); }
  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
  function round(v) { return Math.round(v); }

  var WEEK_CN = ['日', '一', '二', '三', '四', '五', '六'];

  function friendlyDate(s) {
    var t = today();
    if (s === t) return '今天';
    if (s === addDays(t, -1)) return '昨天';
    if (s === addDays(t, -2)) return '前天';
    var d = parseYmd(s);
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 周' + WEEK_CN[d.getDay()];
  }

  /* ---------------- 数据 ---------------- */
  var DEFAULT = {
    v: 1,
    profile: { sex: 'male', age: 30, height: 175, weight: 70 },
    workouts: [],
    weights: []
  };

  var state = load();

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return JSON.parse(JSON.stringify(DEFAULT));
      var s = JSON.parse(raw);
      return {
        v: 1,
        profile: Object.assign({}, DEFAULT.profile, s.profile || {}),
        workouts: Array.isArray(s.workouts) ? s.workouts : [],
        weights: Array.isArray(s.weights) ? s.weights : []
      };
    } catch (e) {
      return JSON.parse(JSON.stringify(DEFAULT));
    }
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      toast('保存失败：浏览器存储不可用');
    }
  }

  /* ---------------- 器械与公式 ---------------- */
  var MACHINES = {
    treadmill: { name: '跑步机', emoji: '🏃', met: 9.8, incline: true, speed: true, acsm: true },
    'incline-walk': { name: '坡度快走', emoji: '🚶', met: 6.0, incline: true, speed: true, acsm: true },
    elliptical: { name: '椭圆机', emoji: '🌀', met: 5.0 },
    bike: { name: '动感单车', emoji: '🚴', met: 7.0 },
    rower: { name: '划船机', emoji: '🚣', met: 7.0 },
    stair: { name: '爬楼机', emoji: '🪜', met: 9.0 },
    other: { name: '其他有氧', emoji: '💪', met: 6.0 }
  };

  var STRENGTH_MET = { light: 3.5, mid: 5.0, high: 6.0 };
  var STRENGTH_NAME = { light: '轻', mid: '中', high: '高' };

  var EXERCISES = ['深蹲', '硬拉', '卧推', '推举', '引体向上', '划船', '腿举', '腿弯举', '腿屈伸',
    '箭步蹲', '臀桥', '侧平举', '弯举', '三头下压', '肩推', '俯卧撑', '卷腹', '平板支撑', '其他'];

  function bmr() {
    var p = state.profile;
    var base = 10 * p.weight + 6.25 * p.height - 5 * p.age;
    return base + (p.sex === 'male' ? 5 : -161);
  }
  function tdee() {
    // 训练人群按中等活动系数估算日常消耗
    return bmr() * 1.55;
  }
  function bmi() {
    var p = state.profile;
    return p.height > 0 ? p.weight / Math.pow(p.height / 100, 2) : 0;
  }

  /* ACSM 跑步机/坡度走：VO2(ml/kg/min) → kcal */
  function acsmKcal(speedKmh, inclinePct, minutes, kg) {
    var v = speedKmh * 1000 / 60;          // m/min
    var grade = inclinePct / 100;
    var vo2 = v > 134
      ? (0.2 * v + 0.9 * v * grade + 3.5)  // 跑步方程
      : (0.1 * v + 1.8 * v * grade + 3.5); // 步行方程
    return vo2 * kg / 1000 * 5 * minutes;
  }

  /* MET 公式 */
  function metKcal(met, minutes, kg) {
    return met * 3.5 * kg / 200 * minutes;
  }

  /* Keytel 心率公式 */
  function keytelKcal(hr, minutes) {
    var p = state.profile;
    var perMin;
    if (p.sex === 'male') {
      perMin = (-55.0969 + 0.6309 * hr + 0.1988 * p.weight + 0.2017 * p.age) / 4.184;
    } else {
      perMin = (-20.4022 + 0.4472 * hr - 0.1263 * p.weight + 0.074 * p.age) / 4.184;
    }
    return Math.max(0, perMin * minutes);
  }

  /* 计算一条训练的主消耗 */
  function estimate(w) {
    var kg = state.profile.weight;
    if (w.type === 'strength') {
      return metKcal(STRENGTH_MET[w.level] || 5, w.minutes, kg);
    }
    var m = MACHINES[w.machine] || MACHINES.other;
    if (m.acsm) {
      var kcal = acsmKcal(w.speed, w.incline, w.minutes, kg);
      // 速度极慢时 ACSM 会低估，用 2.5 MET 作地板值
      return Math.max(kcal, metKcal(2.5, w.minutes, kg));
    }
    return metKcal(m.met, w.minutes, kg);
  }

  function entryKcal(w) { return round(w.kcal || 0); }

  /* ---------------- 渲染：头部 ---------------- */
  function renderHeader() {
    var d = new Date();
    $('#dateLabel').textContent = d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() +
      '日 周' + WEEK_CN[d.getDay()];
    var st = streak();
    $('#streakPill').textContent = st > 0 ? '连续 ' + st + ' 天' : '还没开始';
  }

  function streak() {
    var days = {};
    state.workouts.forEach(function (w) { days[w.date] = 1; });
    var n = 0, cur = today();
    if (!days[cur]) cur = addDays(cur, -1);
    while (days[cur]) { n++; cur = addDays(cur, -1); }
    return n;
  }

  /* ---------------- 渲染：今日 ---------------- */
  function renderToday() {
    var t = today();
    var list = state.workouts.filter(function (w) { return w.date === t; });
    var kcal = list.reduce(function (s, w) { return s + entryKcal(w); }, 0);
    var mins = list.reduce(function (s, w) { return s + num(w.minutes); }, 0);

    $('#todayKcal').textContent = kcal.toLocaleString('en-US');
    $('#todayCount').textContent = list.length + ' 项';
    $('#todayMin').textContent = round(mins);
    $('#todayTdee').textContent = round(tdee()).toLocaleString('en-US');
    renderWeek();
  }

  function mondayOf(d) {
    var x = new Date(d.getTime());
    var wd = (x.getDay() + 6) % 7; // 周一 = 0
    x.setDate(x.getDate() - wd);
    return ymd(x);
  }

  function renderWeek() {
    var mon = mondayOf(new Date());
    var t = today();
    var max = 1, sums = [];
    for (var i = 0; i < 7; i++) {
      var day = addDays(mon, i);
      var k = state.workouts.filter(function (w) { return w.date === day; })
        .reduce(function (s, w) { return s + entryKcal(w); }, 0);
      sums.push({ day: day, kcal: k });
      if (k > max) max = k;
    }
    var html = sums.map(function (s, i) {
      var h = Math.max(3, Math.round(s.kcal / max * 88));
      var cls = s.kcal === 0 ? 'zero' : '';
      var isToday = s.day === t ? ' today' : '';
      return '<div class="wb' + isToday + '"><i class="' + cls + '" style="height:' + h + 'px"></i><span>' +
        ['一', '二', '三', '四', '五', '六', '日'][i] + '</span></div>';
    }).join('');
    $('#weekBars').innerHTML = html;

    var total = sums.reduce(function (s, x) { return s + x.kcal; }, 0);
    var count = state.workouts.filter(function (w) {
      return w.date >= mon && w.date <= addDays(mon, 6);
    });
    var mins = count.reduce(function (s, w) { return s + num(w.minutes); }, 0);
    $('#weekCount').textContent = count.length;
    $('#weekKcal').textContent = total.toLocaleString('en-US');
    $('#weekMin').textContent = round(mins);
    $('#weekRange').textContent = (parseYmd(mon).getMonth() + 1) + '/' + parseYmd(mon).getDate() +
      ' - ' + (parseYmd(addDays(mon, 6)).getMonth() + 1) + '/' + parseYmd(addDays(mon, 6)).getDate();
  }

  /* ---------------- 渲染：记录流 ---------------- */
  function renderFeed() {
    var box = $('#feed');
    if (!state.workouts.length) {
      box.innerHTML = '<p class="empty">还没有训练记录<br /><span class="small">点右上角「＋」开始记录</span></p>';
      $('#emptyHint').textContent = '点右上角「＋」开始记录';
      return;
    }
    $('#emptyHint').textContent = '共 ' + state.workouts.length + ' 条';

    var groups = {};
    state.workouts.slice().sort(function (a, b) {
      return b.date === a.date ? (b.createdAt || 0) - (a.createdAt || 0) : (a.date < b.date ? 1 : -1);
    }).forEach(function (w) {
      (groups[w.date] = groups[w.date] || []).push(w);
    });

    var dates = Object.keys(groups).sort().reverse();
    var html = dates.slice(0, 40).map(function (d) {
      var items = groups[d];
      var sum = items.reduce(function (s, w) { return s + entryKcal(w); }, 0);
      var rows = items.map(entryHtml).join('');
      return '<div class="day-group"><div class="day-label"><b>' + friendlyDate(d) +
        '</b><span>' + items.length + ' 项 · ' + sum.toLocaleString('en-US') + ' kcal</span></div>' +
        rows + '</div>';
    }).join('');
    box.innerHTML = html;

    $$('.entry', box).forEach(function (el) {
      el.addEventListener('click', function (e) {
        var id = el.getAttribute('data-id');
        if (e.target.closest('[data-del]')) {
          e.stopPropagation();
          removeWorkout(id);
          return;
        }
        openSheet('edit', id);
      });
    });
  }

  function entryHtml(w) {
    var kcal = entryKcal(w);
    var hrText = (w.hrKcal ? '<small>心率 ' + round(w.hrKcal) + '</small>' : '');
    var ico, title, meta;
    if (w.type === 'strength') {
      ico = '🏋️';
      title = escapeHtml(w.exercise || '力量训练') + ' ' + num(w.weight) + 'kg × ' + num(w.reps) + ' × ' + num(w.sets) + '组';
      meta = [num(w.minutes) + ' 分钟', STRENGTH_NAME[w.level] + '强度', w.note].filter(Boolean).join(' · ');
      return rowHtml(w, 'entry strength', ico, title, meta, kcal, hrText);
    }
    var m = MACHINES[w.machine] || MACHINES.other;
    ico = m.emoji;
    title = m.name;
    var bits = [];
    if (m.incline && num(w.incline) > 0) bits.push('坡度 ' + num(w.incline) + '%');
    if (m.speed && num(w.speed) > 0) bits.push('速度 ' + num(w.speed) + ' km/h');
    bits.push(num(w.minutes) + ' 分钟');
    if (w.hr) bits.push('心率 ' + num(w.hr));
    if (w.note) bits.push(w.note);
    meta = bits.join(' · ');
    return rowHtml(w, 'entry', ico, title, meta, kcal, hrText);
  }

  function rowHtml(w, cls, ico, title, meta, kcal, hrText) {
    return '<div class="' + cls + '" data-id="' + w.id + '" data-type="' + w.type + '">' +
      '<div class="ico">' + ico + '</div>' +
      '<div class="body"><div class="title">' + title + '</div><div class="meta">' + escapeHtml(meta) + '</div></div>' +
      '<div class="kcal"><b>' + kcal + '</b><small>kcal</small>' + hrText + '</div>' +
      '<button class="del" data-del="1" title="删除">×</button>' +
      '</div>';
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function removeWorkout(id) {
    var w = state.workouts.filter(function (x) { return x.id === id; })[0];
    if (!w) return;
    if (!confirm('删除这条训练记录？')) return;
    state.workouts = state.workouts.filter(function (x) { return x.id !== id; });
    save(); renderAll(); toast('已删除');
  }

  /* ---------------- 渲染：趋势 ---------------- */
  function renderTrend() {
    renderKcalChart();
    renderWeightChart();
    renderKpi();
  }

  function renderKcalChart() {
    var box = $('#kcalChart');
    var days = [];
    var total = 0, active = 0;
    for (var i = 6; i >= 0; i--) {
      var d = addDays(today(), -i);
      var k = state.workouts.filter(function (w) { return w.date === d; })
        .reduce(function (s, w) { return s + entryKcal(w); }, 0);
      days.push({ d: d, k: k });
      total += k;
      if (k > 0) active++;
    }
    if (!total) {
      box.innerHTML = '<p class="empty">还没有记录</p>';
      $('#burn7Note').textContent = '—';
      return;
    }
    $('#burn7Note').textContent = '7 天合计 ' + total.toLocaleString('en-US') + ' kcal · ' + active + ' 天有训练';

    var W = 640, H = 190, padL = 34, padB = 26, padT = 12;
    var max = Math.max.apply(null, days.map(function (x) { return x.k; }).concat([1]));
    max = Math.ceil(max / 100) * 100;
    var bw = (W - padL - 10) / 7;

    var bars = days.map(function (x, i) {
      var h = (H - padB - padT) * (x.k / max);
      var x0 = padL + i * bw + bw * 0.18;
      var w0 = bw * 0.64;
      var y0 = H - padB - h;
      var color = x.d === today() ? '#7ff0c8' : '#35d6a4';
      var label = (parseYmd(x.d).getMonth() + 1) + '/' + parseYmd(x.d).getDate();
      return '<rect x="' + x0 + '" y="' + y0 + '" width="' + w0 + '" height="' + Math.max(2, h) +
        '" rx="5" fill="' + color + '" opacity="' + (x.k ? 0.92 : 0.16) + '"></rect>' +
        (x.k ? '<text x="' + (x0 + w0 / 2) + '" y="' + (y0 - 7) + '" text-anchor="middle" fill="#8d9ab1">' +
          Math.round(x.k) + '</text>' : '') +
        '<text x="' + (x0 + w0 / 2) + '" y="' + (H - 8) + '" text-anchor="middle">' + label + '</text>';
    }).join('');

    var grid = [0, 0.5, 1].map(function (p) {
      var y = padT + (H - padB - padT) * (1 - p);
      return '<line x1="' + padL + '" y1="' + y + '" x2="' + (W - 6) + '" y2="' + y +
        '" stroke="#1e2836" stroke-width="1"></line>' +
        '<text x="' + (padL - 6) + '" y="' + (y + 3) + '" text-anchor="end">' + Math.round(max * p) + '</text>';
    }).join('');

    box.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img">' +
      grid + bars + '</svg>';
  }

  function renderWeightChart() {
    var box = $('#weightChart');
    var pts = state.weights.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    var p = state.profile;

    if (pts.length < 2) {
      box.innerHTML = '<p class="empty">' + (pts.length ? '再记一次体重就能看到趋势' : '在「我的」里填一次体重就能看到曲线') + '</p>';
      $('#weightNote').textContent = pts.length ? '当前 ' + p.weight + ' kg' : '—';
      return;
    }

    var recent = pts.slice(-30);
    var vals = recent.map(function (x) { return x.kg; });
    var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
    var span = Math.max(0.5, max - min);
    min -= span * 0.25; max += span * 0.25;

    var W = 640, H = 200, padL = 40, padR = 14, padT = 16, padB = 26;
    var n = recent.length;
    var xAt = function (i) { return padL + (W - padL - padR) * (n === 1 ? 0.5 : i / (n - 1)); };
    var yAt = function (v) { return padT + (H - padT - padB) * (1 - (v - min) / (max - min)); };

    var path = recent.map(function (x, i) { return (i ? 'L' : 'M') + xAt(i).toFixed(1) + ' ' + yAt(x.kg).toFixed(1); }).join(' ');
    var area = path + ' L' + xAt(n - 1).toFixed(1) + ' ' + (H - padB) + ' L' + xAt(0).toFixed(1) + ' ' + (H - padB) + ' Z';

    var grid = [0, 0.5, 1].map(function (q) {
      var v = min + (max - min) * q;
      var y = yAt(v);
      return '<line x1="' + padL + '" y1="' + y + '" x2="' + (W - padR) + '" y2="' + y +
        '" stroke="#1e2836"></line><text x="' + (padL - 6) + '" y="' + (y + 3) + '" text-anchor="end">' +
        v.toFixed(1) + '</text>';
    }).join('');

    var dots = recent.map(function (x, i) {
      return '<circle cx="' + xAt(i) + '" cy="' + yAt(x.kg) + '" r="3" fill="#5b8cff"></circle>';
    }).join('');

    var first = recent[0], last = recent[n - 1];
    var delta = last.kg - first.kg;
    var days = Math.max(1, Math.round((parseYmd(last.date) - parseYmd(first.date)) / 86400000));
    var perWeek = delta / days * 7;
    $('#weightNote').textContent = (delta >= 0 ? '+' : '') + delta.toFixed(1) + ' kg / ' + days + ' 天（' +
      (perWeek >= 0 ? '+' : '') + perWeek.toFixed(2) + ' kg/周）';

    box.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img">' +
      grid +
      '<defs><linearGradient id="wg" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="#5b8cff" stop-opacity=".28"></stop>' +
      '<stop offset="100%" stop-color="#5b8cff" stop-opacity="0"></stop></linearGradient></defs>' +
      '<path d="' + area + '" fill="url(#wg)"></path>' +
      '<path d="' + path + '" fill="none" stroke="#5b8cff" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"></path>' +
      dots +
      '<text x="' + xAt(0) + '" y="' + (H - 6) + '" text-anchor="start">' + friendlyShort(first.date) + '</text>' +
      '<text x="' + xAt(n - 1) + '" y="' + (H - 6) + '" text-anchor="end">' + friendlyShort(last.date) + '</text>' +
      '</svg>';
  }

  function friendlyShort(s) {
    var d = parseYmd(s);
    return (d.getMonth() + 1) + '/' + d.getDate();
  }

  function renderKpi() {
    var ws = state.workouts;
    var totalKcal = ws.reduce(function (s, w) { return s + entryKcal(w); }, 0);
    var totalMin = ws.reduce(function (s, w) { return s + num(w.minutes); }, 0);
    var days = {};
    ws.forEach(function (w) { days[w.date] = 1; });
    var dayCount = Object.keys(days).length;
    var avg = ws.length ? totalKcal / ws.length : 0;
    var maxOne = ws.reduce(function (m, w) { return Math.max(m, entryKcal(w)); }, 0);

    var cells = [
      ['总次数', ws.length, '次'],
      ['总消耗', totalKcal.toLocaleString('en-US'), 'kcal'],
      ['总时长', (totalMin / 60).toFixed(1), '小时'],
      ['平均每次', round(avg), 'kcal'],
      ['单次最高', maxOne, 'kcal'],
      ['打卡天数', dayCount, '天']
    ];
    $('#kpiGrid').innerHTML = cells.map(function (c) {
      return '<div class="kpi"><span>' + c[0] + '</span><b>' + c[1] + '</b><small>' + c[2] + '</small></div>';
    }).join('');
  }

  /* ---------------- 渲染：我的 ---------------- */
  function renderProfile() {
    var p = state.profile;
    $('#pSex').value = p.sex;
    $('#pAge').value = p.age;
    $('#pHeight').value = p.height;
    $('#pWeight').value = p.weight;

    $('#statBmr').textContent = round(bmr()).toLocaleString('en-US');
    $('#statTdee').textContent = round(tdee()).toLocaleString('en-US');
    var b = bmi();
    $('#statBmi').textContent = b ? b.toFixed(1) : '—';
  }

  function renderAll() {
    renderHeader();
    renderToday();
    renderFeed();
    renderTrend();
    renderProfile();
  }

  /* ---------------- 弹窗表单 ---------------- */
  var sheet = $('#sheet');
  var currentType = 'cardio';
  var editingId = null;

  function openSheet(mode, id) {
    editingId = id || null;
    var w = null;
    if (id) w = state.workouts.filter(function (x) { return x.id === id; })[0];

    $('#sheetTitle').textContent = id ? '编辑记录' : '记一次训练';
    setType(w ? w.type : currentType);

    if (w) {
      if (w.type === 'strength') {
        $('#sName').value = w.exercise || '';
        $('#sWeight').value = num(w.weight);
        $('#sReps').value = num(w.reps, 10);
        $('#sSets').value = num(w.sets, 3);
        $('#sMinutes').value = num(w.minutes, 15);
        $('#sLevel').value = w.level || 'mid';
      } else {
        $('#cMachine').value = w.machine || 'treadmill';
        $('#cIncline').value = num(w.incline);
        $('#cSpeed').value = num(w.speed, 6);
        $('#cMinutes').value = num(w.minutes, 30);
        $('#cHr').value = w.hr || '';
      }
      $('#wNote').value = w.note || '';
    } else {
      $('#cMinutes').value = 30;
      $('#cHr').value = '';
      $('#wNote').value = '';
      $('#sMinutes').value = 15;
    }

    syncMachineFields();
    updateEstimate();
    sheet.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeSheet() {
    sheet.hidden = true;
    document.body.style.overflow = '';
    editingId = null;
  }

  function setType(t) {
    currentType = t;
    $$('.seg-btn').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-type') === t); });
    $('#cardioFields').hidden = t !== 'cardio';
    $('#strengthFields').hidden = t !== 'strength';
  }

  function syncMachineFields() {
    var m = MACHINES[$('#cMachine').value] || MACHINES.other;
    $('#inclineField').style.display = m.incline ? '' : 'none';
    $('#speedField').style.display = m.speed ? '' : 'none';
  }

  function readCardio() {
    return {
      type: 'cardio',
      machine: $('#cMachine').value,
      incline: num($('#cIncline').value),
      speed: num($('#cSpeed').value),
      minutes: num($('#cMinutes').value),
      hr: num($('#cHr').value) || null,
      note: $('#wNote').value.trim()
    };
  }

  function readStrength() {
    return {
      type: 'strength',
      exercise: ($('#sName').value || '').trim(),
      weight: num($('#sWeight').value),
      reps: num($('#sReps').value),
      sets: num($('#sSets').value),
      minutes: num($('#sMinutes').value),
      level: $('#sLevel').value,
      note: $('#wNote').value.trim()
    };
  }

  function updateEstimate() {
    var w = currentType === 'cardio' ? readCardio() : readStrength();
    var main = 0, hr = null, note = '';

    if (w.type === 'cardio') {
      var m = MACHINES[w.machine] || MACHINES.other;
      main = estimate(w);
      if (m.acsm) {
        note = 'ACSM 公式：VO₂ = 0.1×速度 + 1.8×速度×坡度 + 3.5，按体重 ' + state.profile.weight + ' kg 换算。';
      } else {
        note = m.name + '按 MET ' + m.met + ' 估算（' + state.profile.weight + ' kg）。';
      }
      if (w.hr) {
        hr = keytelKcal(w.hr, w.minutes);
        note += ' 心率公式已按 ' + w.hr + ' 次/分修正。';
      }
    } else {
      main = estimate(w);
      note = '力量训练按 MET ' + (STRENGTH_MET[w.level] || 5) + '（' + STRENGTH_NAME[w.level] + '强度）× 有效时长估算，不含组间休息。';
      if (!w.exercise) note += ' 建议填上动作名称。';
    }

    $('#estMain').textContent = round(main);
    $('#estHr').textContent = hr == null ? '—' : round(hr);
    $('#estNote').textContent = note + ' 心率公式结果仅供参考，器械公式更贴近实际。';

    if (hr != null && main > 0) {
      var diff = Math.abs(hr - main) / main;
      if (diff > 0.35) $('#estNote').textContent += ' 两者相差 ' + Math.round(diff * 100) + '%，建议检查心率或速度输入。';
    }
    return { main: main, hr: hr };
  }

  function submitForm(e) {
    e.preventDefault();
    var w = currentType === 'cardio' ? readCardio() : readStrength();
    if (w.type === 'cardio' && (!w.minutes || w.minutes <= 0)) return toast('请填训练时长');
    if (w.type === 'strength' && !w.exercise) return toast('请填动作名称');
    if (w.type === 'strength' && w.minutes <= 0) return toast('请填有效时长');

    var est = updateEstimate();
    w.kcal = round(est.main);
    w.hrKcal = est.hr == null ? null : round(est.hr);
    w.date = editingId ? (state.workouts.filter(function (x) { return x.id === editingId; })[0] || {}).date || today() : today();
    w.createdAt = editingId ? (state.workouts.filter(function (x) { return x.id === editingId; })[0] || {}).createdAt || Date.now() : Date.now();

    if (editingId) {
      state.workouts = state.workouts.map(function (x) { return x.id === editingId ? Object.assign({}, x, w, { id: editingId }) : x; });
      toast('已更新');
    } else {
      w.id = uid();
      state.workouts.push(w);
      toast('已记录 ' + w.kcal + ' kcal');
    }
    save(); closeSheet(); renderAll();
  }

  /* ---------------- 导入导出 ---------------- */
  function exportData() {
    var data = JSON.stringify(state, null, 2);
    var blob = new Blob([data], { type: 'application/json' });
    var a = document.createElement('a');
    var d = new Date();
    a.href = URL.createObjectURL(blob);
    a.download = 'fittrack-' + ymd(d) + '.json';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    toast('已导出备份文件');
  }

  function importData(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var s = JSON.parse(reader.result);
        if (!s || !Array.isArray(s.workouts)) throw new Error('格式不对');
        if (!confirm('导入会覆盖当前 ' + state.workouts.length + ' 条记录，继续？')) return;
        state.profile = Object.assign({}, DEFAULT.profile, s.profile || {});
        state.workouts = s.workouts || [];
        state.weights = Array.isArray(s.weights) ? s.weights : [];
        save(); renderAll(); toast('导入成功：' + state.workouts.length + ' 条记录');
      } catch (err) {
        toast('导入失败：文件不是有效备份');
      }
    };
    reader.readAsText(file);
  }

  /* ---------------- 提示 ---------------- */
  var toastTimer;
  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2200);
  }

  /* ---------------- 事件绑定 ---------------- */
  function activateTab(name) {
    $$('.tab').forEach(function (x) { x.classList.toggle('active', x.getAttribute('data-tab') === name); });
    $$('.panel').forEach(function (p) { p.classList.toggle('active', p.id === 'panel-' + name); });
  }

  function bind() {
    $$('.tab').forEach(function (b) {
      b.addEventListener('click', function () {
        activateTab(b.getAttribute('data-tab'));
        if (history.replaceState) history.replaceState(null, '', '#' + b.getAttribute('data-tab'));
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    });

    $('#addBtn').addEventListener('click', function () { openSheet('new'); });

    $$('[data-close]').forEach(function (el) {
      el.addEventListener('click', closeSheet);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !sheet.hidden) closeSheet();
    });

    $$('.seg-btn').forEach(function (b) {
      b.addEventListener('click', function () {
        setType(b.getAttribute('data-type'));
        updateEstimate();
      });
    });

    ['#cMachine', '#cIncline', '#cSpeed', '#cMinutes', '#cHr'].forEach(function (s) {
      var el = $(s);
      el.addEventListener('input', function () {
        if (s === '#cMachine') syncMachineFields();
        updateEstimate();
      });
      el.addEventListener('change', updateEstimate);
    });
    ['#sName', '#sWeight', '#sReps', '#sSets', '#sMinutes', '#sLevel'].forEach(function (s) {
      var el = $(s);
      el.addEventListener('input', updateEstimate);
      el.addEventListener('change', updateEstimate);
    });

    $('#wForm').addEventListener('submit', submitForm);

    // 身体数据
    ['#pSex', '#pAge', '#pHeight', '#pWeight'].forEach(function (s) {
      $(s).addEventListener('change', function () {
        state.profile.sex = $('#pSex').value;
        state.profile.age = clamp(num($('#pAge').value, 30), 12, 90);
        state.profile.height = clamp(num($('#pHeight').value, 175), 120, 230);
        state.profile.weight = clamp(num($('#pWeight').value, 70), 30, 250);

        var t = today();
        var kg = state.profile.weight;
        var found = state.weights.filter(function (x) { return x.date === t; })[0];
        if (found) found.kg = kg;
        else state.weights.push({ date: t, kg: kg });

        save(); renderAll();
      });
    });

    $('#exportBtn').addEventListener('click', exportData);
    $('#importBtn').addEventListener('click', function () { $('#importFile').click(); });
    $('#importFile').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (f) importData(f);
      e.target.value = '';
    });
    $('#resetBtn').addEventListener('click', function () {
      if (!confirm('确定清空全部训练和体重记录？此操作不可撤销。')) return;
      state = JSON.parse(JSON.stringify(DEFAULT));
      save(); renderAll(); toast('已清空');
    });

    // 器械下拉/动作建议
    $('#exNames').innerHTML = EXERCISES.map(function (x) { return '<option value="' + x + '"></option>'; }).join('');
  }

  /* ---------------- PWA ---------------- */
  function initPwa() {
    var el = $('#pwaState');
    var standalone = window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true;
    if (location.protocol === 'file:') {
      el.textContent = '当前是本地文件模式，PWA 与离线缓存需通过网址（http/https）打开才生效。';
      return;
    }
    if (standalone) {
      el.textContent = '已作为独立应用运行。';
    } else {
      el.textContent = '按上面的步骤添加到主屏幕即可全屏使用。';
    }
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').then(function () {
        if (!standalone) el.textContent = '离线缓存已就绪，可添加到主屏幕。';
      }).catch(function () { /* 忽略：file:// 或非安全上下文 */ });
    }
  }

  /* ---------------- 示例数据（预览用：?demo=1） ---------------- */
  function seedDemo() {
    if (state.workouts.length) return;
    var t = today();
    var demo = [
      { date: t, type: 'cardio', machine: 'treadmill', incline: 15, speed: 4, minutes: 50, hr: 130, note: '坡度走' },
      { date: t, type: 'strength', exercise: '深蹲', weight: 60, reps: 8, sets: 4, minutes: 22, level: 'mid', note: '' },
      { date: addDays(t, -1), type: 'cardio', machine: 'elliptical', incline: 0, speed: 0, minutes: 35, hr: 122, note: '' },
      { date: addDays(t, -2), type: 'strength', exercise: '卧推', weight: 50, reps: 10, sets: 4, minutes: 25, level: 'mid', note: '最后一组吃力' },
      { date: addDays(t, -3), type: 'cardio', machine: 'bike', incline: 0, speed: 0, minutes: 40, hr: 135, note: '' },
      { date: addDays(t, -5), type: 'cardio', machine: 'incline-walk', incline: 10, speed: 5, minutes: 45, hr: 118, note: '' },
      { date: addDays(t, -7), type: 'strength', exercise: '硬拉', weight: 80, reps: 6, sets: 4, minutes: 28, level: 'high', note: '' }
    ];
    demo.forEach(function (d, i) {
      var est = 0;
      if (d.type === 'cardio') {
        var m = MACHINES[d.machine];
        est = m.acsm ? acsmKcal(d.speed, d.incline, d.minutes, state.profile.weight)
          : metKcal(m.met, d.minutes, state.profile.weight);
      } else {
        est = metKcal(STRENGTH_MET[d.level], d.minutes, state.profile.weight);
      }
      d.kcal = round(est);
      d.hrKcal = d.hr ? round(keytelKcal(d.hr, d.minutes)) : null;
      d.id = 'demo' + i;
      d.createdAt = Date.now() - i * 1000;
    });
    state.workouts = demo;
    state.weights = [
      { date: addDays(t, -21), kg: state.profile.weight + 1.4 },
      { date: addDays(t, -14), kg: state.profile.weight + 0.8 },
      { date: addDays(t, -7), kg: state.profile.weight + 0.3 },
      { date: t, kg: state.profile.weight }
    ];
    save();
  }

  /* ---------------- 启动 ---------------- */
  document.addEventListener('DOMContentLoaded', function () {
    if (/[?&]demo=1/.test(location.search)) seedDemo();
    if (!state.weights.length) {
      state.weights.push({ date: today(), kg: state.profile.weight });
      save();
    }
    bind();
    renderAll();
    var h = (location.hash || '').replace('#', '');
    if (h === 'trend' || h === 'me' || h === 'log') activateTab(h);
    if (h === 'new') openSheet('new');
    initPwa();
  });
})();
