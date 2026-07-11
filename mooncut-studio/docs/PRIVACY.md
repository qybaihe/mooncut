# MoonCut Studio — Privacy

## What stays local

- Project folders you choose  
- Imported and recorded media  
- Job artifacts, logs, quality reports  
- Provider profile metadata (URLs, model names)  

## What is not collected by MoonCut Studio

- No MoonCut account  
- No telemetry backend in this baseline  
- No automatic community publish  
- No email sending  

## Secrets

- API keys are stored via Electron `safeStorage` (macOS Keychain / Windows DPAPI when available).  
- Keys are never written into `mooncut.project.json`, git, crash screenshots intentionally, or diagnostic bundles.  
- Logs and errors pass through redaction before UI display where applicable.  

## Network

- Default: local-only; Agent Host on `127.0.0.1`.  
- Remote OpenAI-compatible endpoints: only after the user enables network providers and saves a Profile.  
- When remote is enabled, UI states that data may be sent to the user-configured base URL (prompts, and video frames only if the user enables frame upload).  

## Diagnostics

- “Export diagnostic bundle” excludes API keys and user media; includes versions, dependency status, redacted agent logs.
