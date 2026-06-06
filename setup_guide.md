# Beginner-Friendly Setup, Deployment, & AdSense Guide

Hello! This guide will walk you through setting up your secure classroom website step-by-step and getting it approved by **Google AdSense**.

Even if you have never written code before, don't worry! Just follow these steps one by one, and you will have a secure, ad-ready, view-only lecture website running in no time.

---

## 📋 How This System Works (and Beats the "Low Value Content" Rejection)

Google AdSense uses automated crawling bots to screen websites. Because your notes are stored as secure, non-downloadable images, AdSense bots cannot "read" the text inside them. To the bot, your site looks like a series of blank pages, triggering a **"Low Value Content"** or **"Thin Content"** rejection.

To solve this, this website implements a **"Summary + Interactive Study Guide"** model:
1. **The Notes Folder**: You place your notes HTML files directly into subject and lecture folders inside the unified notes folder (e.g., `notes/Maths/Lecture 1/notes.html`).
2. **Preventing Name Conflicts**: If different subjects use the same folder name, they are kept separate and isolated. Each note page gets its own independent URL, design, and search indexing.
3. **The Companion JSON File**: You can place a JSON file named `notes.json` alongside the HTML file inside the same folder containing a detailed summary, learning objectives, and a practice quiz.
4. **The Python Sync Script**: The uploader script scans the `notes/` directory recursively. It reads the HTML file and its companion JSON metadata (if present), uploads them to Cloudflare R2, and tracks the upload status in a local `.sync_manifest.json` file.
5. **Smart Syncing**: The script compares file modification times against the manifest, so running `python uploader.py` will only upload files that are new or have been edited since the last run. No files are moved or deleted locally.
6. **The Website**: When a student (or an AdSense bot) visits a page, the website reads the custom metadata (or uses the fallback template) and displays a rich, crawlable HTML study guide (summary, objectives, quiz) alongside the secure, right-click disabled viewer. The bot gets the text it wants for approval, while your actual lecture notes remain completely locked and protected.

---

## 🛠️ Step 1: Install & Set Up Python on Your Computer

We need Python to run the automation script that converts your PDFs to images and uploads metadata.

1. **Download Python**: 
   - Go to [python.org/downloads](https://www.python.org/downloads/) and download the installer for **Windows** or **Mac**.
   - **CRITICAL FOR WINDOWS**: When running the installer, make sure to check the box at the bottom that says **"Add Python to PATH"** (or **"Add python.exe to PATH"**). If you miss this, your computer won't recognize Python commands.
2. **Open Your Terminal (Command Line)**:
   - **Windows**: Press the Windows Key, type `cmd` or `PowerShell`, and press Enter.
   - **Mac**: Press `Cmd + Space`, type `Terminal`, and press Enter.
3. **Install the Libraries**:
   Copy and paste this command into your terminal and press **Enter**:
   ```bash
   pip install pymupdf boto3 python-dotenv
   ```

---

## ☁️ Step 2: Create a Cloudflare Account & Get Storage Keys

Cloudflare will host your website for free and store your page images in a secure database called **R2**.

### A. Create Your Storage Bucket
1. Go to [cloudflare.com](https://www.cloudflare.com/) and sign up for a free account.
2. In the left-hand sidebar, click on **R2 (Object Storage)**.
3. If prompted, input a payment method. *Note: Cloudflare R2 has a massive free tier (10 GB of storage and 10 million reads/uploads per month free), so you will likely never pay a single cent for this project.*
4. Click **Create Bucket**.
5. Name your bucket (e.g., `bitsnotes-bucket`) and click **Create Bucket**.

### B. Get Your Account ID & Credentials
We need to give your local computer permission to upload files to this bucket.
1. Go back to the main **R2** dashboard page.
2. Look on the right-hand side of the page and find your **Account ID** (a long string of random letters and numbers). Copy it!
3. On the R2 dashboard, click **Manage R2 API Tokens** (in the top right corner).
4. Click **Create API Token**.
5. Set the token details:
   - **Token name**: `bitsnotes-uploader-token`
   - **Permissions**: Select **Admin Read & Write** (this allows the script to upload files).
   - **TTL (Expiry)**: Choose **Forever** (or a duration of your choice) so the script doesn't stop working.
6. Click **Create API Token**.
7. Cloudflare will display three keys. **Copy them immediately and save them somewhere safe (like a Notepad file)** because Cloudflare will never show them to you again:
   - **Access Key ID** - e1838d0684c8c28b6dedc76a80527052
   - **Secret Access Key** - 06e4a4d27de21fadad0624ff6732410f0ab9c509bae0a4fc77d1fc97fd31d577
token vaue - cfat_ZSmn56JHEBtA2uIvbCYIXQwR3tEoknQBw0sxGIIubc061163
---

## ⚙️ Step 3: Configure & Run Your Local Python Script

Now, let's configure the Python script using the keys you just copied.

1. Locate the `local_uploader` folder inside your project.
2. Open the file named `.env` in any text editor (like Notepad, TextEdit, or VS Code).
3. Replace the placeholder text with your actual details:
   ```ini
   # --- Option A: HTTP Uploader (Recommended - Bypasses S3 API ISP Blocks) ---
   # Set to your live worker URL (e.g. https://bitsnotes.com) or http://localhost:8787 for local testing
   WEBSITE_URL=http://localhost:8787
   UPLOAD_SECRET=06e4a4d27de21fadad0624ff6732410f0ab9c509bae0a4fc77d1fc97fd31d577

   # --- Option B: Direct S3 Uploader (Standard S3 Access Keys) ---
   CLOUDFLARE_ACCOUNT_ID=paste_your_account_id_here
   R2_ACCESS_KEY_ID=paste_your_access_key_id_here
   R2_SECRET_ACCESS_KEY=paste_your_secret_access_key_here
   R2_BUCKET_NAME=bitsnotes-bucket
   ```
4. Save and close the file.
5. In your terminal, navigate to the `local_uploader` folder. Run this command:
   ```bash
   python uploader.py
   ```
6. The script will scan the watch folder, process and upload any found PDFs (along with their companion JSON files if present) to R2, and then exit.

### How to use the Subject / Lecture Folders & Companion JSON Workflow:
Organize files locally and in R2 as **Subject → Lecture → files** (e.g. `Deep Reinforcement Learning/Lecture 1/notes.html`).

* **Subject folder**: Inside the `notes` directory, create a folder per subject (e.g. `notes/Deep Reinforcement Learning/`).
* **Lecture folder**: Inside each subject, create a folder per lecture (e.g. `notes/Deep Reinforcement Learning/Lecture 1/`).
* **HTML and Companion JSON**: Place your HTML note file (e.g. `notes.html`) and optionally a companion JSON file (e.g. `notes.json`) inside the lecture folder.
  * **Option A**: Custom JSON (e.g., `notes.json`) in the same folder → uploads your study guide metadata.
  * **Option B**: Embedded Script → Embed a `<script type="application/json" id="lecture-metadata">` tag directly inside your HTML note file.
  * **Option C**: No JSON/Script → the website will use a fallback study guide template on the page.
* **Syncing**: Run `python uploader.py` to synchronize any new or modified notes. Unchanged notes are skipped automatically.
* **Pruning deleted notes**: Run `python uploader.py --prune` to automatically delete any notes from Cloudflare R2 that you have deleted locally from your `notes/` directory.
* **Forcing re-upload**: Run `python uploader.py --force` to upload all notes regardless of whether they have changed.
* **Re-run / Re-upload**: Run `python uploader.py --reupload` to clear the R2 bucket entirely and re-sync all notes.

#### 🤖 AI Prompt Template to Generate Companion JSON:
```text
Act as an educational content writer. I have a lecture document for the subject [INSERT SUBJECT NAME]. I want you to write a study guide metadata block in JSON format. Do not write any markdown code block formatting, just the raw JSON text.

JSON Structure:
{
  "title": "Title of the notes",
  "subject": "[INSERT SUBJECT NAME]",
  "gradeLevel": "e.g., Grade 10 / Undergrad",
  "datePublished": "Current Date",
  "targetAudience": "Who is this study guide for?",
  "summary": "Write a 150 to 300 word detailed overview of the concepts covered in these notes.",
  "keyConcepts": [
    "Objective 1: What will a student learn?",
    "Objective 2",
    "Objective 3"
  ],
  "sections": [
    { "title": "Section Title 1", "pages": "Pages 1-2", "description": "Quick 1 sentence description" },
    { "title": "Section Title 2", "pages": "Pages 3-5", "description": "Quick 1 sentence description" }
  ],
  "quiz": [
    {
      "question": "Multiple choice question 1?",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "answerIndex": 0,
      "explanation": "Detailed explanation of why Option A is correct."
    }
  ]
}

Here are the notes: [PASTE YOUR LECTURE TEXT HERE]
```

---

## 🚀 Step 4: Deploy Your Website to Cloudflare (Free)

Now, let's put your website on the internet so students can access it and AdSense can crawl it.

### A. Align Your Bucket Name in the Code
1. Open the file named `wrangler.jsonc` in the root folder of your project using any text editor.
2. Find this section (around line 10):
   ```json
   "r2_buckets": [
       {
           "binding": "BUCKET",
           "bucket_name": "bitsnotes-bucket"
       }
   ],
   ```
3. Change `"bitsnotes-bucket"` to the exact name of the bucket you created in **Step 2A**.
4. Save and close the file.

### B. Log Into Cloudflare from Your Computer
1. In your terminal, make sure you are in the project root folder (`e:\Projects\bitsnotes`).
2. Run this command:
   ```bash
   npx wrangler login
   ```
3. A browser window will automatically open. Log into your Cloudflare account and click the blue **Allow** button.

### C. Build and Deploy
1. Compile your website files by running:
   ```bash
   npm run build
   ```
2. Deploy your website to Cloudflare Workers by running:
   ```bash
   npx wrangler deploy
   ```
3. Wrangler will upload your project and route it to your custom domain (e.g., `https://bitsnotes.com`).

---

## 📢 Step 5: Google AdSense Approval Checklist

To get your site approved quickly, we have already added the mandatory structural pages that Google requires. Make sure you customize them:

1. **About Project (`/about`)**: Explains your mission as a teacher to provide secure, free educational materials.
2. **Contact Us (`/contact`)**: Offers a contact form and a direct support email. (Make sure you monitor the email you list here!).
3. **Privacy Policy (`/privacy`)**: Informally details cookie usage, log files, and lists standard Google AdSense cookie preferences. This is a strict legal requirement.
4. **Ads.txt (`public/ads.txt`)**: Once you sign up for Google AdSense, they will give you a publisher ID. You should edit the `public/ads.txt` file and add your custom publisher line (e.g., `google.com, pub-XXXXXXXXXXXXXXXX, DIRECT, f08c47fec0942fa0`).
