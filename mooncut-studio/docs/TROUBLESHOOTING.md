# Troubleshooting

| Symptom | Likely cause | Recovery |
|---------|--------------|----------|
| App opens but agent “unhealthy” | Agent process crash / port bind | Settings → Restart Agent Host; check diagnostic export |
| Import works, no duration | FFmpeg/ffprobe missing | Install FFmpeg; re-import or probe again |
| Real agent fails immediately | Missing gateway / models / remotion | Switch to mock to validate UI; configure Provider; install deps |
| Remote test fails | Wrong URL/key/network policy | Errors are redacted; fix Profile; enable “allow remote providers” |
| Cancel leaves job cancelled | Expected | Intermediate files kept; source media never deleted |
| Camera denied | OS permission | System Settings → Privacy → Camera/Microphone; retry from UI |
| Path errors | Outside project root | Re-import via app dialog (never paste arbitrary absolute paths from model output) |
| Windows pack fails on Mac | Cross-build limits | Run `npm run pack:win` on Windows CI agent |
| Unsigned macOS “damaged” | Gatekeeper | Internal builds: remove quarantine or sign with Developer ID |

## Logs

- Agent: `userData/logs/agent-host.log`  
- Diagnostics: Settings → Export diagnostic package  
