import { common } from '@kit.AbilityKit';
import { uniformTypeDescriptor as utd } from '@kit.ArkData';
import { fileIo as fs, fileUri } from '@kit.CoreFileKit';
import { systemShare } from '@kit.ShareKit';

/** Presents the native system share sheet for a downloaded MoonCut result. */
export class VideoShareService {
  static async share(context: common.UIAbilityContext, localPath: string, title: string): Promise<void> {
    if (!localPath || localPath.startsWith('file://')) {
      localPath = localPath.replace(/^file:\/\//, '');
    }
    if (!localPath) throw new Error('请先下载成片再分享');
    if (fs.statSync(localPath).size <= 0) throw new Error('成片文件为空，无法分享');
    const typeId = utd.getUniformDataTypeByFilenameExtension('.mp4', utd.UniformDataType.VIDEO);
    const record: systemShare.SharedRecord = {
      utd: typeId,
      uri: fileUri.getUriFromPath(localPath),
      title,
      description: 'MoonCut 成片'
    };
    const data = new systemShare.SharedData(record);
    const controller = new systemShare.ShareController(data);
    await controller.show(context, {
      selectionMode: systemShare.SelectionMode.SINGLE,
      previewMode: systemShare.SharePreviewMode.DETAIL
    });
  }
}
