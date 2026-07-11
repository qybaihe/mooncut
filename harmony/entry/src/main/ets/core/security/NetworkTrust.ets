import { common } from '@kit.AbilityKit';
import { fileIo as fs } from '@kit.CoreFileKit';

/** Copies the bundled public CA to a path accepted by Network Kit. */
export class NetworkTrust {
  static async prepareBundledCA(context: common.UIAbilityContext): Promise<string> {
    const bytes = await context.resourceManager.getRawFileContent('mooncut-ca.crt');
    if (bytes.byteLength === 0) throw new Error('MoonCut 生产 CA 为空，拒绝建立生产连接');
    const path = `${context.filesDir}/mooncut-ca.crt`;
    const file = fs.openSync(path, fs.OpenMode.CREATE | fs.OpenMode.READ_WRITE | fs.OpenMode.TRUNC);
    try { fs.writeSync(file.fd, bytes.buffer); } finally { fs.closeSync(file); }
    return path;
  }
}
