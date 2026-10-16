// The Login Pass: a QR code image that signs a student in with no typing.
//
// The QR code holds a sign-in link, /signin.html#pass=<secret>. The secret sits
// after the #, so browsers never send it to any server in a URL; the sign-in
// page reads it and posts it to /api/account. The downloaded file is a PNG of
// the pass, so the same file can be uploaded later, printed, or held up to a
// webcam. Teachers' one-time sign-in links (#link=<secret>) work the same way.

import qrcode from '/vendor/qrcode-generator/qrcode.mjs';

const SECRET = /^[A-Za-z0-9_-]{32,64}$/;

export const passUrl = (secret) => `${location.origin}/signin.html#pass=${secret}`;
export const linkUrl = (token) => `${location.origin}/signin.html#link=${token}`;

/**
 * Finds a pass or link secret in scanned or pasted text: a full sign-in URL
 * (#pass= or #link=) or a bare secret (treated as a pass).
 * @returns {{ pass?: string, token?: string } | null}
 */
export function readSecret(text) {
  const s = String(text ?? '').trim();
  const m = s.match(/[#&?](pass|link)=([A-Za-z0-9_-]{32,64})(?![A-Za-z0-9_-])/);
  if (m) return m[1] === 'pass' ? { pass: m[2] } : { token: m[2] };
  return SECRET.test(s) ? { pass: s } : null;
}

/** Draws a QR code for `text` on a new canvas, `scale` pixels per module with a quiet zone. */
export function qrCanvas(text, scale = 8) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const quiet = 4;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = (n + quiet * 2) * scale;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000000';
  for (let r = 0; r < n; r += 1) {
    for (let c = 0; c < n; c += 1) if (qr.isDark(r, c)) ctx.fillRect((c + quiet) * scale, (r + quiet) * scale, scale, scale);
  }
  return canvas;
}

/** The downloadable pass: a white card with the username and the QR code. */
export function passCard(user, secret) {
  const qr = qrCanvas(passUrl(secret), 8);
  const pad = 32;
  const width = Math.max(qr.width + pad * 2, 520);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = qr.height + 230;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#047857';
  ctx.fillRect(0, 0, canvas.width, 10);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#0f172a';
  ctx.font = '700 28px system-ui, sans-serif';
  ctx.fillText('Student Atlas Login Pass', width / 2, 58);
  ctx.font = '600 24px system-ui, sans-serif';
  ctx.fillText(`${user.emoji ? `${user.emoji} ` : ''}${user.username}`, width / 2, 96);
  ctx.drawImage(qr, (width - qr.width) / 2, 112);
  ctx.font = '18px system-ui, sans-serif';
  ctx.fillStyle = '#334155';
  const y = 112 + qr.height + 34;
  ctx.fillText('Upload this picture or show it to your webcam to sign in.', width / 2, y);
  ctx.fillText('Keep it private: anyone with this pass can open your account.', width / 2, y + 28);
  ctx.fillText(location.host, width / 2, y + 56);
  return canvas;
}

export function downloadCanvas(canvas, filename) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      resolve();
    }, 'image/png');
  });
}

// ---- Reading a pass --------------------------------------------------------------------
let reader = null;
/** Loads the QR reader (jsQR, about 250 KB) only when a student scans or uploads. */
function loadReader() {
  reader ??= new Promise((resolve, reject) => {
    if (window.jsQR) { resolve(window.jsQR); return; }
    const script = document.createElement('script');
    script.src = '/vendor/jsqr/jsQR.js';
    script.onload = () => (window.jsQR ? resolve(window.jsQR) : reject(new Error('QR reader missing')));
    script.onerror = () => { reader = null; reject(new Error('Couldn’t load the QR reader. Check your connection and try again.')); };
    document.head.append(script);
  });
  return reader;
}

function decodeFrom(jsQR, source, width, height, canvas = document.createElement('canvas')) {
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, width, height);
  const found = jsQR(ctx.getImageData(0, 0, width, height).data, width, height, { inversionAttempts: 'attemptBoth' });
  return found?.data ?? null;
}

/** Reads the secret from an uploaded Login Pass image (or a text file holding the link). */
export async function readPassFile(file) {
  if (!file) return null;
  if (file.size > 15 * 1024 * 1024) throw new Error('That file is too big to be a Login Pass.');
  if (/^text\//.test(file.type) || /\.txt$/i.test(file.name)) return readSecret(await file.text());
  const jsQR = await loadReader();
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('That file isn’t a picture we can read. Choose the Login Pass image you downloaded.');
  }
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const text = decodeFrom(jsQR, bitmap, Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
  bitmap.close?.();
  return text ? readSecret(text) : null;
}

export const cameraSupported = () => Boolean(navigator.mediaDevices?.getUserMedia);

/**
 * Scans the webcam until a Login Pass (or sign-in link) shows up.
 * Resolves to the secret, or null when stopped. Call stop() to end early.
 */
export function scanCamera(video) {
  let stream = null;
  let stopped = false;
  let finish;
  const done = new Promise((resolve) => { finish = resolve; });
  const stop = (result = null) => {
    if (stopped) return;
    stopped = true;
    stream?.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
    finish(result);
  };
  (async () => {
    const jsQR = await loadReader();
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
    video.srcObject = stream;
    video.setAttribute('playsinline', '');
    video.muted = true;
    await video.play();
    const canvas = document.createElement('canvas');
    let last = 0;
    const tick = (time) => {
      if (stopped) return;
      if (time - last > 150 && video.videoWidth) {
        last = time;
        const scale = Math.min(1, 800 / video.videoWidth);
        const text = decodeFrom(jsQR, video, Math.round(video.videoWidth * scale), Math.round(video.videoHeight * scale), canvas);
        const secret = text ? readSecret(text) : null;
        if (secret) { stop(secret); return; }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  })().catch((err) => {
    if (stopped) return;
    stopped = true;
    stream?.getTracks().forEach((t) => t.stop());
    const denied = err?.name === 'NotAllowedError' || err?.name === 'SecurityError';
    const none = err?.name === 'NotFoundError' || err?.name === 'OverconstrainedError';
    finish(Promise.reject(new Error(denied
      ? 'Camera access was blocked. Allow the camera for this site, or upload your Login Pass instead.'
      : none ? 'We couldn’t find a camera. Upload your Login Pass instead.' : (err?.message || 'The camera didn’t start. Upload your Login Pass instead.'))));
  });
  return { done, stop: () => stop(null) };
}
