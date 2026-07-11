# MoonCut Studio

Professional **local-first** desktop workstation for MoonCut’s talking-head pipeline.  
Electron + Vue + TypeScript. No login. No cloud identity.

## Quick start

```bash
cd mooncut-studio
npm install
npm run build
npm test
npm run verify
npm run dev
```

## Packages

| Package | Purpose |
|---------|---------|
| `@mooncut/studio-shared` | IPC contracts & domain types |
| `@mooncut/studio-project-format` | Portable projects + index |
| `@mooncut/studio-bootstrapper` | Dependency detection |
| `@mooncut/studio-agent-host` | Mock/real Agent supervisor |
| `@mooncut/studio-desktop` | Electron app |

## Docs

- [ARCHITECTURE.md](./docs/ARCHITECTURE.md)  
- [RISK_REGISTER.md](./docs/RISK_REGISTER.md)  
- [DEPENDENCY_MATRIX.md](./docs/DEPENDENCY_MATRIX.md)  
- [INSTALL.md](./docs/INSTALL.md)  
- [PRIVACY.md](./docs/PRIVACY.md)  
- [LICENSES.md](./docs/LICENSES.md)  
- [TROUBLESHOOTING.md](./docs/TROUBLESHOOTING.md)  
- [RELEASE.md](./docs/RELEASE.md)  

## Packaging

```bash
npm run pack:mac
npm run pack:win
```

Signing/notarization requires external certificates (not included).
