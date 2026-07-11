import { describe, expect, it } from '@ohos/hypium';
import { jobStageTitle } from '../../../main/ets/core/api/APIModels';
import { themeTokens, themeTokensForSystem } from '../../../main/ets/core/design/AppTheme';
import {
  PetAnimationState, PetEvent, ThemeMode, petAnimationDurationMs, petAnimationFrameCount, petAnimationRow,
  petEventMessage, petEventState, splitDraftSentences
} from '../../../main/ets/core/models/AppModels';
import { motionScalesRequestReduced } from '../../../main/ets/core/accessibility/SystemMotionPreference';

export default function parityTest(): void {
  describe('MoonCut iOS parity contracts', () => {
    it('uses the same server-owned job stage labels', 0, () => {
      expect(jobStageTitle('transcribing')).assertEqual('转写口播');
      expect(jobStageTitle('tracking-speaker')).assertEqual('跟脸取景');
      expect(jobStageTitle('visual-quality-review')).assertEqual('质检');
      expect(jobStageTitle('interrupted')).assertEqual('任务中断');
    });

    it('keeps all three product themes', 0, () => {
      expect(themeTokens(ThemeMode.LIGHT).usesMemphisChrome).assertFalse();
      expect(themeTokens(ThemeMode.LIGHT).canvas).assertEqual('#F6F5F4');
      expect(themeTokens(ThemeMode.DARK).videoWell).assertEqual('#000000');
      expect(themeTokens(ThemeMode.DARK).surface).assertEqual('#212429');
      expect(themeTokens(ThemeMode.MEMPHIS).usesMemphisChrome).assertTrue();
      expect(themeTokens(ThemeMode.MEMPHIS).canvas).assertEqual('#FBF1E0');
      expect(themeTokens(ThemeMode.MEMPHIS).inset).assertEqual('#F5E6CC');
      expect(themeTokens(ThemeMode.MEMPHIS).stickerYellow).assertEqual('#FFD61F');
      expect(themeTokensForSystem(ThemeMode.MEMPHIS, true).canvas).assertEqual('#29211C');
      expect(themeTokensForSystem(ThemeMode.MEMPHIS, true).textPrimary).assertEqual('#F7F0E6');
    });

    it('uses the same pet sprite rows and timing as iOS', 0, () => {
      expect(petAnimationRow(PetAnimationState.WAVING)).assertEqual(3);
      expect(petAnimationRow(PetAnimationState.REVIEW)).assertEqual(8);
      expect(petAnimationFrameCount(PetAnimationState.JUMPING)).assertEqual(5);
      expect(petAnimationFrameCount(PetAnimationState.FAILED)).assertEqual(8);
      expect(petAnimationDurationMs(PetAnimationState.FAILED)).assertEqual(2080);
    });

    it('stops pet animation when any system animation scale is disabled', 0, () => {
      expect(motionScalesRequestReduced('1', '1', '1')).assertFalse();
      expect(motionScalesRequestReduced('0', '1', '1')).assertTrue();
      expect(motionScalesRequestReduced('1', '0', '1')).assertTrue();
      expect(motionScalesRequestReduced('1', '1', '0')).assertTrue();
    });

    it('maps real business pet events exactly like iOS', 0, () => {
      expect(petEventState(PetEvent.UPLOADING)).assertEqual(PetAnimationState.RUNNING);
      expect(petEventState(PetEvent.COACH_LISTENING)).assertEqual(PetAnimationState.WAVING);
      expect(petEventState(PetEvent.COACH_OFF_CAMERA)).assertEqual(PetAnimationState.WAITING);
      expect(petEventState(PetEvent.COACH_LOW_VOLUME)).assertEqual(PetAnimationState.REVIEW);
      expect(petEventState(PetEvent.JOB_FAILED)).assertEqual(PetAnimationState.FAILED);
      expect(petEventMessage(PetEvent.COACH_OFF_CAMERA)).assertEqual('我好像没看见你，看向镜头试试？');
    });

    it('preserves punctuation when splitting teleprompter sentences', 0, () => {
      const sentences = splitDraftSentences('第一句。第二句！\n最后一句');
      expect(sentences.length).assertEqual(3);
      expect(sentences[0]).assertEqual('第一句。');
      expect(sentences[1]).assertEqual('第二句！');
      expect(sentences[2]).assertEqual('最后一句');
    });
  });
}
