# Fix camera not visible in the Board step
- Agent: Claude
- Time: 2026-11-19 19:30 (local)
- Ask: The webcam preview in the setup wizard's Board step only shows "No signal"; make the camera visible.

## Tasks
- [x] Find why the preview never recovers (single open attempt, no retry)
- [x] Retry opening the webcam every 2.5 s after a failure
- [x] Run wizard tests
- [ ] Confirm with the real camera (user)
