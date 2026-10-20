# Unsent

*Write what you couldn't say.*

**Unsent** is a beautifully designed, secure, and fully offline-capable personal diary Progressive Web App (PWA). Built for intimacy, calmness, and privacy, this application acts as a private night journal.

🌐 **Live App**: [https://unsent-eosin.vercel.app](https://unsent-eosin.vercel.app)

---

## 🎨 Design Philosophy: "Soft Midnight"

The UI is meticulously crafted around the **Soft Midnight** design scheme.
- **Mood**: Private, calm, intimate, safe.
- **Aesthetic**: A dark, cozy, moonlit diary. Emotional but not dramatic; peaceful but not childish.
- **Visuals**: Lots of empty space, no harsh borders, subtle soft shadows, and 24px rounded cards. Interactions feature slow, calming fade transitions.
- **Color Palette**:
  - **Backgrounds**: Deep Navy (`#111827`), Soft Charcoal (`#1F2937`)
  - **Cards**: Muted Slate (`#2D3748`), Warm Gray (`#3A3A40`)
  - **Accents**: Dusty Rose (`#D8A7B1`), Soft Lavender (`#B8A4D9`)
  - **Typography**: Warm Beige (`#E8D8C3`), Main Text (`#F8F4F0`), Muted (`#B9B4AE`)

---

## ✨ Core Features

### 📅 Calendar View (Your Days)
Navigate your diary visually through a soft monthly calendar. Days with written entries are marked with a gentle dusty rose indicator, allowing you to easily look back on past feelings.

### 🔍 Memory Search
Find specific memories, feelings, or words instantly. Search operates securely on your device, featuring Mood tags you assign while writing so you can filter your entries by how you felt that day.

### 📎 Attached Memories
Words aren't always enough. You can attach images, short videos, and files directly to your entries. Attachments are uploaded securely to your private Supabase storage bucket, displayed as soft preview cards below your writing.

### ⏳ "On This Day" (Past Memories)
Every time you open the app, it instantly checks today's date against your entire database. If you wrote an entry on this exact calendar day in any previous year, a subtle card appears at the top of your journal, quietly surfacing nostalgic memories.

### 📦 Memory Export
You have complete ownership of your data. Generate a downloadable `.zip` file of your entire diary with a single click. Exports include a beautifully formatted chronological text file, a JSON backup, and automatic downloads of all your media attachments.

### 🎙️ Talk-to-Type (Voice Dictation)
Sometimes it is easier to speak your thoughts. Unsent natively integrates the Web Speech API, allowing you to seamlessly dictate your diary entries in real-time. Simply click the microphone icon and speak out loud.

### 🔑 Change Password
You can change your account password at any time from the Settings panel. When updated, the app automatically re-hashes and stores the new password locally so that offline unlock continues to work seamlessly with your new credentials.

### ⚡ Offline First & Background Sync
You don't need internet to use your diary.
- **Read & Write Offline**: Using `IndexedDB` caching, you can open the app, search, and write entries while in airplane mode or entirely offline.
- **Silent Sync**: As soon as your device reconnects to the internet, Unsent silently uploads any pending diary entries to the secure database in the background. *(Note: File attachments currently require an active internet connection).*

---

## 🔒 Security, Local Lock, & Multi-Tenancy

Privacy is the core feature of Unsent.

### Row Level Security (RLS)
The database is built on PostgreSQL with **Row Level Security (RLS)** strictly enforced on both the `entries` and `entry_attachments` tables, as well as the Storage Bucket. Even though multiple users can share the same database, it is mathematically impossible for one user to read, update, or delete another user's journal entries or files.

### The Local Lock
To maintain absolute privacy while supporting offline capabilities, Unsent uses a **Local Lock** mechanism:
- When you log in online, the app cryptographically hashes your password and saves it locally.
- If you open the app without internet, you are prompted to unlock the diary using that exact same password.
- This guarantees your diary remains locked to prying eyes without requiring a connection to the server to verify your identity.

### Customizable Auto-Lock
Never worry about leaving your diary open accidentally. Unsent features an idle timer that automatically locks the app after a customizable period of inactivity (e.g., 5 minutes, 15 minutes), returning it to the secure password prompt.

---

## 🛠 Tech Stack

- **Frontend**: React + Vite + VitePWA
- **Date Math**: `date-fns` for robust calendar generation
- **Utilities**: `react-idle-timer` for security, `jszip` for data exports
- **Caching**: `idb-keyval` (IndexedDB)
- **Styling**: Vanilla CSS (Strict adherence to the Soft Midnight design tokens)
- **Backend & Auth**: Supabase (PostgreSQL + GoTrue Auth + Supabase Storage)
- **Typography**: Playfair Display (Titles), Inter (Body), Literata/Georgia (Writing Interface)

---

## 🚀 Getting Started

### 1. Prerequisites
- Node.js (v18+)
- A Supabase account / project

### 2. Local Setup

Clone the repository and install dependencies:
```bash
npm install
```

### 3. Environment Variables
Create a `.env.local` file in the root directory and add your Supabase credentials:
```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-public-key
DATABASE_URL="postgresql://postgres.your-project:your-password@aws-0-eu-central-1.pooler.supabase.com:5432/postgres"
```

### 4. Database Setup
A `setup_db.js` file is included in the project root to automate the database initialization. It will read the `DATABASE_URL` from your `.env.local` file. Run:
```bash
node --env-file=.env.local setup_db.js
```
*This script automatically creates the `entries` and `entry_attachments` tables, sets up the private Storage Bucket, and applies all necessary RLS privacy policies.*

### 5. Running the App
Start the Vite development server:
```bash
npm run dev
```
Navigate to `http://localhost:5173/` in your browser.

### 6. Deployment
This app is 100% deployment-ready for platforms like Vercel, Netlify, or Render.
- Ensure your `.env.local` remains securely on your machine (it is automatically ignored by Git).
- In your hosting provider's dashboard, manually add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as Environment Variables.
- You do *not* need to include `DATABASE_URL` in production, as it is only used locally for the initial database setup.

#### Supabase Auth URL Configuration (Required for Deployed Apps)
After deploying, you **must** update your Supabase project settings so that email confirmation links point to your live app instead of localhost:
1. Go to your [Supabase Dashboard](https://supabase.com/dashboard) → **Authentication** → **URL Configuration**.
2. Set the **Site URL** to `https://unsent-eosin.vercel.app`.
3. Add `https://unsent-eosin.vercel.app` to the **Additional Redirect URLs** list.