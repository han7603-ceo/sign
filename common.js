// 전자계약 화면 공용: 서버 호출, 알림, 서명 패드, 도장 다듬기, 지급 정보 암호화
// window.CONTRACT_API(config.js)에 구글 앱스 스크립트 주소가 들어 있다.
(function () {
  var b = document.createElement('div'); b.id = 'busy'; b.innerHTML = '<div class="spinner"></div><div id="busyText">처리 중…</div>';
  var t = document.createElement('div'); t.id = 'toast'; t.setAttribute('role', 'status');
  document.body.appendChild(b); document.body.appendChild(t);
})();

// ---------------------------------------------------------------- 서버 호출
function api(name) {
  var args = Array.prototype.slice.call(arguments, 1);
  // text/plain으로 보내야 다른 주소(구글)로 바로 보낼 수 있다(사전 확인 요청 없음)
  return fetch(window.CONTRACT_API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ name: name, args: args }), redirect: 'follow' })
    .then(function (r) { return r.text(); }, function () { throw new Error('인터넷 연결을 확인하고 다시 시도해 주세요.'); })
    .then(function (s) {
      var r; try { r = JSON.parse(s); } catch (e) { throw new Error('서버 응답을 읽지 못했습니다. 잠시 뒤 다시 시도해 주세요.'); }
      if (!r.ok) throw new Error(r.error);
      return r.data;
    });
}

// ---------------------------------------------------------------- 화면 도구
function $(s, el) { return (el || document).querySelector(s); }
function $$(s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

function busy(on, text) { $('#busy').classList.toggle('on', !!on); $('#busyText').textContent = text || '처리 중…'; }
var toastTimer;
function toast(msg, ms) {
  var t = $('#toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove('on'); }, ms || 2600);
}
// 서버 일을 하는 동안 덮개를 씌우고, 실패하면 알림
function run(text, promise) {
  busy(true, text);
  return promise.then(function (r) { busy(false); return r; }, function (e) { busy(false); toast(e.message, 4500); throw e; });
}

function modal(title, bodyHtml) {
  var ov = document.createElement('div');
  ov.className = 'overlay';
  ov.innerHTML = '<div class="modal" role="dialog" aria-modal="true"><div class="mh"><b>' + esc(title) + '</b><button class="btn" data-close>닫기</button></div><div class="mb">' + bodyHtml + '</div></div>';
  ov.addEventListener('click', function (e) { if (e.target === ov || e.target.hasAttribute('data-close')) ov.remove(); });
  document.body.appendChild(ov);
  return ov;
}

function copyText(text) {
  function fallback() {
    var ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast('복사했습니다.'); } catch (e) { toast('복사가 안 됩니다. 길게 눌러 복사해 주세요.'); }
    ta.remove();
  }
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { toast('복사했습니다.'); }, fallback);
  else fallback();
}

// 휴대폰이면 공유 창(카톡 등), 안 되면 복사
function shareLink(title, text, url) {
  if (navigator.share) {
    navigator.share({ title: title, text: text, url: url }).catch(function (e) { if (e && e.name !== 'AbortError') copyText(url); });
  } else copyText(url);
}

function downloadB64(file) {
  var bin = atob(file.b64), bytes = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  var url = URL.createObjectURL(new Blob([bytes], { type: file.mime }));
  var a = document.createElement('a');
  a.href = url; a.download = file.name; a.target = '_blank'; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
}

function fileToDataUrl(file) {
  return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(r.result); }; r.onerror = rej; r.readAsDataURL(file); });
}
function loadImage(src) {
  return new Promise(function (res, rej) { var i = new Image(); i.onload = function () { res(i); }; i.onerror = function () { rej(new Error('그림을 읽지 못했습니다.')); }; i.src = src; });
}

// 투명한 가장자리를 잘라낸다
function trimCanvas(c) {
  var ctx = c.getContext('2d'), d = ctx.getImageData(0, 0, c.width, c.height).data;
  var x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
  for (var y = 0; y < c.height; y++) for (var x = 0; x < c.width; x++) {
    if (d[(y * c.width + x) * 4 + 3] > 10) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
  }
  if (x1 < 0) return null;
  var pad = 6, w = x1 - x0 + 1 + pad * 2, h = y1 - y0 + 1 + pad * 2, out = document.createElement('canvas');
  out.width = w; out.height = h;
  out.getContext('2d').drawImage(c, x0 - pad, y0 - pad, w, h, 0, 0, w, h);
  return out;
}

// 도장 사진: 흰 바탕을 투명하게 바꾸고 가장자리를 잘라 PNG로
function stampFromFile(file) {
  return fileToDataUrl(file).then(loadImage).then(function (img) {
    var max = 600, r = Math.min(1, max / Math.max(img.width, img.height));
    var c = document.createElement('canvas'); c.width = Math.round(img.width * r); c.height = Math.round(img.height * r);
    var ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0, c.width, c.height);
    var id = ctx.getImageData(0, 0, c.width, c.height), d = id.data;
    for (var i = 0; i < d.length; i += 4) {
      var lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      if (lum > 215) d[i + 3] = 0;
      else if (lum > 160) d[i + 3] = Math.round(d[i + 3] * (215 - lum) / 55);
    }
    ctx.putImageData(id, 0, 0);
    var t = trimCanvas(c);
    if (!t) throw new Error('도장이 잘 보이지 않습니다. 흰 종이에 찍어 밝은 곳에서 찍어 주세요.');
    return t.toDataURL('image/png');
  });
}

// 신분증·통장 사진: 긴 변 1600px JPEG로 줄인다
function compressPhoto(file) {
  return fileToDataUrl(file).then(loadImage).then(function (img) {
    var r = Math.min(1, 1600 / Math.max(img.width, img.height));
    var c = document.createElement('canvas'); c.width = Math.round(img.width * r); c.height = Math.round(img.height * r);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.82);
  });
}

// ---------------------------------------------------------------- 서명 패드
function SignaturePad(box) {
  var canvas = box.querySelector('canvas'), hint = box.querySelector('.hint, .ph'), ctx, drawing = false, last = null, empty = true, self = this;
  function resize() {
    var dpr = Math.max(1, window.devicePixelRatio || 1), r = canvas.getBoundingClientRect();
    if (!r.width) return;
    canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
    ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = ctx.fillStyle = '#1b2a6b';
    empty = true; if (hint) hint.style.display = '';
  }
  function pos(e) { var r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top, t: Date.now() }; }
  canvas.addEventListener('pointerdown', function (e) {
    e.preventDefault(); try { canvas.setPointerCapture(e.pointerId); } catch (x) { /* 일부 브라우저 */ }
    drawing = true; last = pos(e);
    ctx.beginPath(); ctx.arc(last.x, last.y, 1.4, 0, Math.PI * 2); ctx.fill();
    if (empty) { empty = false; if (hint) hint.style.display = 'none'; }
  });
  canvas.addEventListener('pointermove', function (e) {
    if (!drawing) return; e.preventDefault();
    var p = pos(e), dist = Math.hypot(p.x - last.x, p.y - last.y), v = dist / Math.max(1, p.t - last.t);
    ctx.lineWidth = Math.max(1.6, Math.min(3.6, 3.6 - v * 1.2));
    ctx.beginPath(); ctx.moveTo(last.x, last.y);
    var mx = (last.x + p.x) / 2, my = (last.y + p.y) / 2;
    ctx.quadraticCurveTo(last.x, last.y, mx, my); ctx.lineTo(p.x, p.y); ctx.stroke();
    last = p;
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (ev) { canvas.addEventListener(ev, function () { drawing = false; }); });
  this.clear = resize;
  this.isEmpty = function () { return empty; };
  this.toDataUrl = function () { var t = trimCanvas(canvas); return t ? t.toDataURL('image/png') : null; };
  setTimeout(resize, 0);
  window.addEventListener('resize', function () { if (empty) resize(); });
}

// ---------------------------------------------------------------- 지급 정보 암호화
// 관리자 쪽: RSA 키를 만들어 비밀키를 관리자 암호(PBKDF2)로 잠근다. 서버에는 공개키와 잠근 비밀키만 간다.
// 서명하는 쪽: 임의의 AES 키로 내용을 잠그고, 그 키를 공개키로 잠근다.
var subtle = window.crypto && window.crypto.subtle;
function abToB64(buf) { var b = new Uint8Array(buf), s = ''; for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s); }
function b64ToAb(s) { var bin = atob(s), b = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i); return b.buffer; }
function rand(n) { var b = new Uint8Array(n); crypto.getRandomValues(b); return b; }

function passKey(pass, salt) {
  return subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']).then(function (k) {
    return subtle.deriveKey({ name: 'PBKDF2', salt: salt, iterations: 250000, hash: 'SHA-256' }, k, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  });
}

function makeKeys(pass) {
  if (!subtle) return Promise.reject(new Error('이 브라우저는 암호화를 지원하지 않습니다.'));
  var pair, salt = rand(16), iv = rand(12), pub;
  return subtle.generateKey({ name: 'RSA-OAEP', modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['encrypt', 'decrypt'])
    .then(function (p) { pair = p; return subtle.exportKey('spki', p.publicKey); })
    .then(function (spki) { pub = abToB64(spki); return subtle.exportKey('pkcs8', pair.privateKey); })
    .then(function (pk) { return passKey(pass, salt).then(function (k) { return subtle.encrypt({ name: 'AES-GCM', iv: iv }, k, pk); }); })
    .then(function (ct) { return { pub: pub, encPriv: { salt: abToB64(salt), iv: abToB64(iv), ct: abToB64(ct) } }; });
}

function sealForAdmin(pubB64, obj) {
  if (!subtle) return Promise.reject(new Error('이 브라우저는 암호화를 지원하지 않습니다. 다른 브라우저로 열어 주세요.'));
  var aes, iv = rand(12), ct;
  return subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt'])
    .then(function (k) { aes = k; return subtle.encrypt({ name: 'AES-GCM', iv: iv }, k, new TextEncoder().encode(JSON.stringify(obj))); })
    .then(function (c) { ct = c; return subtle.importKey('spki', b64ToAb(pubB64), { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']); })
    .then(function (pk) { return subtle.exportKey('raw', aes).then(function (raw) { return subtle.encrypt({ name: 'RSA-OAEP' }, pk, raw); }); })
    .then(function (wk) { return { wk: abToB64(wk), iv: abToB64(iv), ct: abToB64(ct) }; });
}

function openBox(encPriv, pass, box) {
  return passKey(pass, new Uint8Array(b64ToAb(encPriv.salt)))
    .then(function (k) { return subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(b64ToAb(encPriv.iv)) }, k, b64ToAb(encPriv.ct)); })
    .catch(function () { throw new Error('암호가 맞지 않습니다.'); })
    .then(function (pk) { return subtle.importKey('pkcs8', pk, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['decrypt']); })
    .then(function (priv) { return subtle.decrypt({ name: 'RSA-OAEP' }, priv, b64ToAb(box.wk)); })
    .then(function (raw) { return subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']); })
    .then(function (aes) { return subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(b64ToAb(box.iv)) }, aes, b64ToAb(box.ct)); })
    .then(function (pt) { return JSON.parse(new TextDecoder().decode(pt)); });
}
