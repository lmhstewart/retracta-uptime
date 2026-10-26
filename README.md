# retracta-uptime

External uptime monitor for the Retracta Shopify app. Every 5 minutes GitHub Actions calls
`https://app.withdrawbutton.com/healthz` (the app server and its database). After 2 failed checks in a
row the operator gets one e-mail; when it answers again, one recovery e-mail (Resend).

- Script: `scripts/uptime-check.mjs` (a copy of the one in the private app repository, which also has its tests).
- Secrets: `RESEND_API_KEY` (send-only), `RESEND_FROM_EMAIL`.
- `keepalive.txt` is updated once a month by the workflow, so GitHub does not disable the schedule after 60 days without activity.
- Test the alert without touching production: push a commit with `[test-fail]` in its message (twice, to reach the threshold), then a normal commit for the recovery mail. Or run the workflow manually with a failing `health_url`.
