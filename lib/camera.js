"use client";
// One camera stream, shared by everything that needs it.
//
// Both the preview panel and the pixel face read from the webcam. Opening
// getUserMedia twice for one device is asking for trouble, so the stream is
// acquired once and the same MediaStream is handed to every caller — a single
// stream can back any number of <video> elements.
const WANT = { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } };

let pending = null;

async function acquire() {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("camera not supported in this browser");
  try {
    return await navigator.mediaDevices.getUserMedia({ video: WANT, audio: false });
  } catch (e) {
    // The default device can be the wrong node (a UVC camera exposes a second,
    // metadata-only /dev/video*). Fall back to trying each input in turn.
    try {
      const cams = (await navigator.mediaDevices.enumerateDevices())
        .filter(d => d.kind === "videoinput");
      for (const c of cams) {
        try {
          return await navigator.mediaDevices.getUserMedia({
            video: { ...WANT, deviceId: { exact: c.deviceId } }, audio: false,
          });
        } catch (e2) { /* try the next one */ }
      }
    } catch (e2) { /* fall through */ }
    throw new Error(e.name === "NotAllowedError" ? "camera permission denied" : "no camera found");
  }
}

export function getCameraStream() {
  // Retry on the next call if acquisition failed, rather than caching a reject.
  if (!pending) pending = acquire().catch(e => { pending = null; throw e; });
  return pending;
}
