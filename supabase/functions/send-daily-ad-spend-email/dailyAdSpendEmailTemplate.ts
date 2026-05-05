/** HTML email body for daily cross-platform spend digest (WowDashboard). */

export type DailySpendPayload = {
  reportDate: string;
  rows: { id: string; label: string; spend: number; accent: string }[];
  total: number;
};

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtUsd(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

export function renderDailyAdSpendEmailHtml(p: DailySpendPayload): string {
  const rowsHtml = p.rows
    .map(
      (r) => `
      <tr>
        <td style="padding:14px 16px;border-bottom:1px solid #1e3a5f;font-size:15px;color:#e8eef5;">
          <span style="display:inline-block;width:4px;height:18px;border-radius:2px;background:${esc(r.accent)};vertical-align:middle;margin-right:10px;"></span>
          ${esc(r.label)}
        </td>
        <td style="padding:14px 16px;border-bottom:1px solid #1e3a5f;text-align:right;font-size:15px;font-weight:600;color:#ffffff;">
          ${esc(fmtUsd(r.spend))}
        </td>
      </tr>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Daily ad spend — ${esc(p.reportDate)}</title>
</head>
<body style="margin:0;padding:0;background:#0b1530;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#0b1530;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width:560px;background:#132347;border-radius:12px;overflow:hidden;border:1px solid #1e3a5f;">
          <tr>
            <td style="padding:22px 24px;background:linear-gradient(135deg,#132347 0%,#1a2f55 100%);border-bottom:1px solid #ed1c24;">
              <div style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#8fa8c8;">WowDashboard</div>
              <h1 style="margin:6px 0 0;font-size:20px;font-weight:600;color:#ffffff;">Daily ad spend</h1>
              <p style="margin:8px 0 0;font-size:14px;color:#a8bdd9;">Report date: <strong style="color:#fff;">${esc(p.reportDate)}</strong></p>
            </td>
          </tr>
          <tr>
            <td style="padding:0;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <thead>
                  <tr style="background:#0f1f3d;">
                    <th align="left" style="padding:10px 16px;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#6b8ab8;">AD PLATFORMS</th>
                    <th align="right" style="padding:10px 16px;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#6b8ab8;">SPEND (USD)</th>
                  </tr>
                </thead>
                <tbody>
                  ${rowsHtml}
                  <tr style="background:#0f1f3d;">
                    <td style="padding:16px;font-size:15px;font-weight:600;color:#e8eef5;">Total (all platforms)</td>
                    <td style="padding:16px;text-align:right;font-size:16px;font-weight:700;color:#ed1c24;">${esc(fmtUsd(p.total))}</td>
                  </tr>
                </tbody>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 24px 22px;font-size:12px;color:#6b8ab8;line-height:1.5;">
              Totals are summed from synced dashboard tables (Google: <code style="color:#8fa8c8;">google_campaigns_data</code>;
              Meta: <code style="color:#8fa8c8;">facebook_campaigns_data</code>; Reddit &amp; Microsoft: ad group tables;
              TikTok: <code style="color:#8fa8c8;">tiktok_campaigns_data</code>). Ensure daily sync jobs have completed for full coverage.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
