# WowDashboard

This is the React version of the Agency Dashboard, converted from the original HTML/CSS/JS project. All components and designs match the original `index.html` layout and behavior.

## Setup

```bash
cd WowDashboard
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

## Build

```bash
npm run build
npm run preview   # optional: preview production build
```

## Structure

- **`src/context/AppContext.jsx`** – Global state: current page, sidebar, client, branding, colors, notifications.
- **`src/components/`** – Sidebar, Header, Notification.
- **`src/pages/`** – DashboardPage (Executive Dashboard), GoogleAdsPage, SettingsPage, PlaceholderPage for other sections.
- **`src/data/sampleData.js`** – Sample data (mirrors original `sample-data.js`).
- **`src/utils/format.js`** – Currency, number, percent formatting.
- **`src/styles/`** – `style.css` and `utilities.css` from the original project.

## Features

- **Executive Dashboard** – KPIs, spend by platform, platform efficiency table, subscription funnel, revenue/spend chart, geographic distribution, lead performance, budget allocation.
- **Google Ads** – Filter bar, KPI cards, Campaign Types and Keywords tables (sample data). Other tabs show placeholder; Supabase can be wired in later.
- **White-Label Settings** – Agency name, logo text, primary/accent/warning/danger colors (persisted in `localStorage`).
- **Navigation** – Sidebar sections and pages match the original; collapse/expand sidebar; client selector; Export PDF and Share Report in header.

Design and CSS (including responsive and print styles) are unchanged from the original project.
