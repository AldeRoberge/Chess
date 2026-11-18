export interface CameraDevice { deviceId: string; label: string }

/** Lists video inputs. Browsers hide labels until permission is granted, so open (and immediately release) a stream first. */
export async function listCameras(): Promise<CameraDevice[]> {
  const md = navigator.mediaDevices;
  if (!md?.enumerateDevices) return [];
  try { (await md.getUserMedia({ video: true })).getTracks().forEach((t) => t.stop()); } catch { /* denied: labels stay empty */ }
  const all = await md.enumerateDevices();
  return all.filter((d) => d.kind === "videoinput").map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Camera ${i + 1}` }));
}

/** Open a preview stream for a device (caller owns and must stop it). */
export async function openCamera(deviceId: string): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({ video: { ...(deviceId ? { deviceId: { exact: deviceId } } : {}), width: 640, height: 480 } });
}
