import parityTest from './Parity.test';
import coachMetricsTest from './CoachMetrics.test';
import securityTest from './Security.test';

export default function tests(): void {
  parityTest();
  coachMetricsTest();
  securityTest();
}
