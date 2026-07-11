import { describe, expect, it } from '@ohos/hypium';
import { APIConfiguration, BuildEnvironment } from '../../../main/ets/core/api/APIConfiguration';
import { SecureSessionStore } from '../../../main/ets/core/security/SecureSessionStore';

export default function securityTest(): void {
  describe('MoonCut transport security contracts', () => {
    it('accepts the production HTTPS host', 0, () => {
      const configuration = new APIConfiguration(
        'https://mooncut.me/api', 'mooncut.me', BuildEnvironment.RELEASE, false
      );
      expect(configuration.requiresBundledCA).assertFalse();
      expect(configuration.url('/v1/auth/session')).assertEqual('https://mooncut.me/api/v1/auth/session');
    });

    it('rejects release cleartext transport', 0, () => {
      let rejected = false;
      try {
        new APIConfiguration('http://127.0.0.1:4317', '127.0.0.1', BuildEnvironment.RELEASE, false);
      } catch (_) { rejected = true; }
      expect(rejected).assertTrue();
    });

    it('rejects non-loopback debug cleartext transport', 0, () => {
      let rejected = false;
      try {
        new APIConfiguration('http://192.168.1.10:4317', '192.168.1.10', BuildEnvironment.DEBUG, false);
      } catch (_) { rejected = true; }
      expect(rejected).assertTrue();
    });

    it('accepts the public TLS chain without a bundled CA', 0, () => {
      const configuration = new APIConfiguration(
        'https://mooncut.me/api', 'mooncut.me', BuildEnvironment.RELEASE, false
      );
      expect(configuration.requiresBundledCA).assertFalse();
    });

    it('rejects non-HTTP protocols', 0, () => {
      let rejected = false;
      try {
        new APIConfiguration('ftp://127.0.0.1/resource', '127.0.0.1', BuildEnvironment.DEBUG, false);
      } catch (_) { rejected = true; }
      expect(rejected).assertTrue();
    });

    it('rejects a configured host mismatch', 0, () => {
      let rejected = false;
      try {
        new APIConfiguration('https://api.example.com', 'mooncut.example.com', BuildEnvironment.RELEASE, false);
      } catch (_) { rejected = true; }
      expect(rejected).assertTrue();
    });

    it('persists and overwrites session cookies in Asset Store', 0, async () => {
      const store = new SecureSessionStore('mooncut.test.session.cookie.v1');
      await store.clear();
      try {
        await store.save('mooncut_session=first');
        expect(await store.load()).assertEqual('mooncut_session=first');
        await store.save('mooncut_session=second');
        expect(await store.load()).assertEqual('mooncut_session=second');
      } finally {
        await store.clear();
      }
    });
  });
}
