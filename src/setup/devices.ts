export interface CameraDevice { deviceId: string; label: string }

/** Lists video inputs. Browsers hide labels until permission is granted, so open (and immediately release) a stream first. */
export async function listCameras(): Promise<CameraDevice[]> {
  const md = navigator.mediaDevices;
  if (!md?.enumerateDevices) return [];
  const cams = async () => (await md.enumerateDevices()).filter((d) => d.kind === "videoinput");
  let found = await cams();
  // Only open a stream when names are hidden. On Windows a second open of a busy camera can hang forever
  // (that froze the scan on "already running" and then showed 0), so give up after 4 s and release any late stream.
  if (!found.length || found.some((d) => !d.label)) {
    try {
      const open = md.getUserMedia({ video: true });
      const s = await Promise.race([open, new Promise<null>((r) => setTimeout(() => r(null), 4000))]);
      if (s) s.getTracks().forEach((t) => t.stop()); else void open.then((late) => late.getTracks().forEach((t) => t.stop()), () => {});
    } catch { /* denied: labels stay empty */ }
    const again = await cams();
    if (again.length || !found.length) found = again;
  }
  return found.map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Camera ${i + 1}` }));
}

/** Open a preview stream for a device (caller owns and must stop it). */
export async function openCamera(deviceId: string): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({ video: { ...(deviceId ? { deviceId: { exact: deviceId } } : {}), width: 640, height: 480 } });
}
