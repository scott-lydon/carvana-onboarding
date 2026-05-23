# 60-second demo recording script

> Record on the deployed instance at https://carvana-onboarding.onrender.com.
> Recommend QuickTime screen recording (Cmd+Shift+5) at 1080p with system
> audio. Save to docs/demo-v2.mp4. Each beat below maps to a wall-clock
> moment in the recording.

| t        | action                                                                                                      | expected on-screen                                       |
|----------|-------------------------------------------------------------------------------------------------------------|----------------------------------------------------------|
| 0:00     | Open https://carvana-onboarding.onrender.com in a fresh tab.                                                | Chatbot greeting visible within 2 s.                     |
| 0:05     | Voiceover or caption: "Two days. Sell-side trade-in onboarding. Conversational entry."                      | --                                                       |
| 0:08     | Type: `my plate is XRJ4041 in Texas`. Press Enter.                                                          | User bubble appears immediately.                         |
| 0:12     | Chatbot streams text + vehicle card.                                                                         | "Vehicle identified — 2021 Toyota Highlander" card.      |
| 0:20     | Caption: "Plate misses? Chatbot offers OCR. Same key, same vendor."                                          | --                                                       |
| 0:25     | Tap "Scan VIN with camera" (the green button below the composer).                                            | Camera viewfinder + Capture button.                      |
| 0:30     | Hold a printed or on-screen VIN sticker in frame. Tap Capture.                                              | "Reading the image..." then "Scanned VIN: ..." user msg. |
| 0:38     | Chatbot routes to lookup_vin, surfaces the vehicle card again.                                              | Same Highlander card.                                    |
| 0:44     | Tap "Schedule pickup" (purple button).                                                                      | Calendar grid of 24 slots.                               |
| 0:48     | Pick the first slot.                                                                                         | "Booking ..." then chatbot confirms.                     |
| 0:52     | Caption: "Atomic SQLite booking. Ten parallel bookings, one wins."                                          | --                                                       |
| 0:55     | NpsSurvey appears.                                                                                           | "How likely are you to recommend..."                     |
| 0:57     | Tap score 9, optionally type "fast and honest", tap Submit.                                                  | "Thanks for the feedback" + elapsed time displayed.      |
| 1:00     | Caption: "End-to-end in under a minute. p95 server latency 137 ms."                                          | --                                                       |

## Pre-recording checklist

- [ ] Latest deployed commit is the one you want to demo. `curl https://carvana-onboarding.onrender.com/api/health` should show uptime > 60s.
- [ ] Have a printed VIN sticker ready. The fixture at `tests/fixtures/vin-sticker-test.png` opens in Preview at the right size.
- [ ] Test the camera + scheduler flow once before recording so muscle memory is right.
- [ ] Close all other browser tabs to keep the demo URL bar clean.
- [ ] Disable browser notifications.

## Saving

Save the recording as `docs/demo-v2.mp4`. Commit with message
`docs(demo): v2 60-second flow recording`. The architecture website's
hero stat card references this file path in slice G; updating the
recording does not require an architecture-website rebuild.
