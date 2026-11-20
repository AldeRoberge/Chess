# Make toggle buttons clearly toggles, app-wide
- Agent: Claude
- Time: 2026-11-19 20:30 (local)
- Ask: Toggle-style buttons (like "Try following camera: on/off") should look obviously like toggles everywhere in the app.

## Tasks
- [x] Find every toggle-style button and how they are built
- [x] Shared switch look keyed on aria-pressed (style.css) + setPressed helper
- [x] Applied to quad editor toggles and ribbon toggles (Timings, Bypass, Calibrate, Nodes view)
- [ ] Run tests
