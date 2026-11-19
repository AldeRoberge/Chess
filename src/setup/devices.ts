export interface CameraDevice { deviceId: string; label: string }

/**
 * getUserMedia that cannot hang. On Windows, opening a camera another app (or tab) already holds can leave the
 * promise pending forever, which froze scans and previews. After `ms` it rejects, and a stream that opens late is released.
 */
export function openStream(constraints: MediaStreamConstraints, ms = 6000): Promise<MediaStream> {
  const open = navigator.mediaDevices.getUserMedia(constraints);
  return new Promise<MediaStream>((resolve, reject) => {
    let late = false;
    const timer = setTimeout(() => { late = true; reject(new Error("Camera did not answer in time: another app or tab may be using it.")); }, ms);
    open.then((s) => { clearTimeout(timer); if (late) s.getTracks().forEach((t) => t.stop()); else resolve(s); }, (e) => { clearTimeout(timer); if (!late) reject(e); });
  });
}

/** Lists video inputs. Browsers hide labels until permission is granted, so open (and immediately release) a stream first. */
export async function listCameras(): Promise<CameraDevice[]> {
  const md = navigator.mediaDevices;
  if (!md?.enumerateDevices) return [];
  const cams = async () => (await md.enumerateDevices()).filter((d) => d.kind === "videoinput");
  let found = await cams();
  // Only open a stream when names are hidden: re-opening a busy camera is what used to hang the scan.
  if (!found.length || found.some((d) => !d.label)) {
    try { (await openStream({ video: true }, 4000)).getTracks().forEach((t) => t.stop()); } catch { /* denied, busy or timed out: labels stay empty */ }
    const again = await cams();
    if (again.length || !found.length) found = again;
  }
  return found.map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Camera ${i + 1}` }));
}

/** Open a preview stream for a device (caller owns and must stop it). Rejects instead of hanging. */
export async function openCamera(deviceId: string): Promise<MediaStream> {
  return openStream({ video: { ...(deviceId ? { deviceId: { exact: deviceId } } : {}), width: 640, height: 480 } });
}
