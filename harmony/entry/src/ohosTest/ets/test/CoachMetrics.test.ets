import { describe, expect, it } from '@ohos/hypium';
import { CoachMetricsEngine, countSpokenUnits, estimateFaceOrientation } from '../../../main/ets/services/coaching/CoachMetricsEngine';

export default function coachMetricsTest(): void {
  describe('Real speaking coach metrics', () => {
    it('counts Chinese characters and English words without timer-generated words', 0, () => {
      expect(countSpokenUnits('你好 MoonCut creators')).assertEqual(2);
      expect(countSpokenUnits('MoonCut makes videos')).assertEqual(3);
    });

    it('derives pace from transcript changes in a twelve-second window', 0, () => {
      const engine = new CoachMetricsEngine();
      engine.setSpeechAvailability(true, '语音识别已就绪');
      engine.reset(1000);
      engine.ingestTranscript('一二三四', false, 2000);
      engine.ingestTranscript('一二三四五六七八', false, 4000);
      expect(engine.metrics.wordCount).assertEqual(8);
      expect(engine.metrics.pace > 0).assertTrue();
    });

    it('uses actual face geometry for the orientation estimate', 0, () => {
      const centered = estimateFaceOrientation({centerX: 0.5, centerY: 0.5, width: 0.35, height: 0.45, yaw: 0, roll: 0});
      const missing = estimateFaceOrientation();
      expect((centered.score ?? 0) > 0.8).assertTrue();
      expect(missing.present).assertFalse();
    });

    it('does not invent unavailable metric values', 0, () => {
      const engine = new CoachMetricsEngine();
      expect(engine.metrics.isSpeechAvailable).assertFalse();
      expect(engine.metrics.wordCount).assertEqual(0);
      expect(engine.metrics.faceOrientationScore === undefined).assertTrue();
    });

    it('derives local advice only from available measurements', 0, () => {
      const engine = new CoachMetricsEngine();
      expect(engine.localAdvice().category).assertEqual('steady');
      engine.setVisionAvailability(true, '检测中');
      engine.ingestFace();
      expect(engine.localAdvice().category).assertEqual('camera');
    });
  });
}
