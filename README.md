# Taper

Taper is a small Chrome extension for limiting YouTube Shorts without blocking YouTube entirely.

It tracks Shorts usage over a rolling 24-hour window and can limit by count, active time, or both.

## Features

- Rolling 24-hour Shorts count
- Rolling 24-hour active Shorts time
- Limit modes: Count, Time, Both, Either
- On-page Shorts meter
- Timed blocker every configured Shorts count/time interval
- Limit overlay that pauses Shorts and hides Shorts entry points
- Configurable presence check after the same Short loops repeatedly
- Optional picture-in-picture for YouTube videos with `Alt+P`, disabled on Shorts pages
- First background-tab switch on Shorts pauses playback
- Temporary 5-minute pause
- Locked settings by default to reduce effortless bypassing
- Edit lock after Shorts count or time reaches 80% of its limit

## Install

1. Open `chrome://extensions`.
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select this folder.

## Defaults

- Condition: Count
- Shorts Count Limit: 200
- Shorts Time Limit: 90 minutes
- PiP: Enabled
- Block Every Shorts: 10
- Block Every Minutes: 10
- Block Seconds: 5
- Loop Check Plays: 10

## Privacy

Taper stores settings and usage locally with `chrome.storage.local`.

It has no telemetry, no analytics, no update URL, and no remote API calls. The only host match is YouTube, so the content script can run on YouTube pages.

## Notes

Time tracking only counts when the Shorts page is visible, a video is playing, and there was recent user activity. This avoids counting long idle loops when you step away from the desk.

The interval blocker pauses Shorts and prevents interaction until its countdown finishes. Count and time tracking also pause while a blocker or loop check is active.

If the same Short loops enough times to hit the configured loop check, Taper pauses playback and asks if you are still there.

The extension is intentionally focused on Shorts for now.
