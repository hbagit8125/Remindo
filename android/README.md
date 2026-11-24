# Remindo Widget (Android)

A tiny Android app whose only job is a home-screen widget showing today's reminders and
focus tasks from Remindo. It reads `/api/widget` with a **read-only key** (More → Home-screen
widget → Connect it), refreshes every 30 minutes or when you tap ⟳, and opens Remindo when
you tap it.

Built by GitHub Actions (`.github/workflows/android-widget.yml`) on every change to this
folder; the APK is attached to the `widget-latest` release.

The signing key (`app/remindo-widget.keystore`) is committed on purpose so each build
installs over the last one. It only signs this personal widget.
